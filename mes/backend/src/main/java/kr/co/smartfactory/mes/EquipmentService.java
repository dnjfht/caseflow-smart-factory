package kr.co.smartfactory.mes;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.atomic.AtomicBoolean;
import kr.co.smartfactory.mes.EquipmentSimulator.Asset;
import kr.co.smartfactory.mes.EquipmentSimulator.Life;
import kr.co.smartfactory.mes.EquipmentSimulator.Mode;
import kr.co.smartfactory.mes.EquipmentSimulator.Reading;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * The line's equipment health, failures and maintenance.
 * <ol>
 *   <li>Every case the line launches wears the equipment ({@link EquipmentSimulator}); every few cases each asset's
 *       sensors are read and stored, and the predictive model judges them (cause and remaining life).</li>
 *   <li>When the model sees a failure developing it raises a predictive alarm (주의, then 정비 권장).</li>
 *   <li>When a mode reaches the end of its life the equipment fails: the fault is recorded as 잠금 (LOCKED) and the
 *       PLC's FaultCode stops the whole line - OIP Desktop and the web twin.</li>
 *   <li>The maintenance person marks 수리 (REPAIRING), then 확인 (CONFIRMED): the worn part is renewed, the fault code
 *       is cleared and the line starts again by itself if its work order is still permitted.</li>
 *   <li>Each confirmed failure is a new run-to-failure record; the model is retrained on the synthetic history plus
 *       every failure the line itself has had.</li>
 * </ol>
 */
@Service
public class EquipmentService {
    public static final double SAMPLE_EVERY = 4;       // cases between sensor readings
    public static final double WARN_PROBABILITY = 0.6; // 주의: a failure mode is developing
    public static final double ALERT_RUL = 60;         // 정비 권장: about two 30-case work orders left
    static final ZoneId ZONE = ZoneId.of("Asia/Seoul");

    private final JdbcTemplate db;
    private final MesService mes;
    private final PlcGateway plc;
    private final ObjectMapper json = new ObjectMapper();
    private final Random random = new Random();
    private final Map<String, Life> lives = new LinkedHashMap<>();
    private final Map<String, Integer> lifeNo = new LinkedHashMap<>();
    private final Map<String, Double> sinceReading = new LinkedHashMap<>();
    private final Map<String, Deque<Map<String, Double>>> recent = new LinkedHashMap<>();
    private final Map<String, PdmModel.Prediction> lastPrediction = new LinkedHashMap<>();
    private volatile Map<String, PdmModel> models = Map.of();
    private volatile Map<String, Object> modelInfo = Map.of();
    private final AtomicBoolean training = new AtomicBoolean();
    private int lastLaunched = -1;
    private volatile double speed;

    public EquipmentService(JdbcTemplate db, MesService mes, PlcGateway plc) {
        this.db = db;
        this.mes = mes;
        this.plc = plc;
        List<Map<String, Object>> stored = db.queryForList("SELECT * FROM equipment_life");
        for (Map<String, Object> r : stored) {
            String m = String.valueOf(r.get("mode_code"));
            lives.put(m, new Life(num(r.get("life")), num(r.get("onset")), num(r.get("used"))));
            lifeNo.put(String.valueOf(r.get("asset_code")), ((Number) r.get("life_no")).intValue());
        }
        for (Mode m : EquipmentSimulator.MODES) {
            if (lives.containsKey(m.code())) continue;
            // the line's equipment is not new: each part starts somewhere in its life
            Life l = EquipmentSimulator.newLife(m, random);
            l.used = l.life * 0.7 * random.nextDouble();
            lives.put(m.code(), l);
            lifeNo.putIfAbsent(m.asset(), 1);
            db.update("INSERT INTO equipment_life(mode_code,asset_code,life,onset,used,life_no) VALUES (?,?,?,?,?,?)",
                m.code(), m.asset(), l.life, l.onset, l.used, 1);
        }
        for (Asset a : EquipmentSimulator.ASSETS) {
            Deque<Map<String, Double>> d = new ArrayDeque<>();
            List<String> last = db.queryForList("SELECT sensor_values FROM equipment_reading WHERE asset_code=? AND life_no=? ORDER BY id DESC LIMIT ?",
                String.class, a.code(), lifeNo.get(a.code()), PdmModel.WINDOW);
            for (int i = last.size() - 1; i >= 0; i--) d.addLast(values(last.get(i)));
            recent.put(a.code(), d);
            sinceReading.put(a.code(), 0.0);
        }
        List<String> sp = db.queryForList("SELECT setting_value FROM app_setting WHERE setting_key='pdm.speed'", String.class);
        speed = sp.isEmpty() ? 1 : Double.parseDouble(sp.get(0));
        retrain("시작");
        // a fault left open by a restart still holds the line
        Integer open = openFaultCode();
        if (open != null) { try { plc.equipmentFault(open); } catch (Exception ignored) { } }
    }

    static double num(Object o) { return o instanceof Number n ? n.doubleValue() : Double.parseDouble(String.valueOf(o)); }

    private Map<String, Double> values(String s) {
        return json.readValue(s, new TypeReference<LinkedHashMap<String, Double>>() {});
    }

    /** called every second or two: wear the equipment with what the line launched since the last call */
    public synchronized void tick() {
        PlcSnapshot s = mes.latest();
        if (!s.connected()) return;
        int launched = s.launched();
        if (lastLaunched < 0 || launched < lastLaunched) { lastLaunched = launched; return; } // first look, or counters reset
        double delta = (launched - lastLaunched) * speed;
        lastLaunched = launched;
        Integer open = openFaultCode();
        if (open != null) { try { plc.equipmentFault(open); } catch (Exception ignored) { } return; } // stopped: no wear
        if (delta <= 0) return;
        Mode failed = null;
        for (Mode m : EquipmentSimulator.MODES) {
            Life l = lives.get(m.code());
            l.used += delta;
            if (l.used >= l.life && failed == null) failed = m;
        }
        for (Asset a : EquipmentSimulator.ASSETS) {
            double since = sinceReading.merge(a.code(), delta, Double::sum);
            if (since >= SAMPLE_EVERY) { sinceReading.put(a.code(), 0.0); read(a); }
        }
        persistLives();
        if (failed != null) fail(failed);
    }

    private void persistLives() {
        for (var e : lives.entrySet())
            db.update("UPDATE equipment_life SET used=?, updated_at=CURRENT_TIMESTAMP WHERE mode_code=?", e.getValue().used, e.getKey());
    }

    private double units(String asset) {
        return EquipmentSimulator.modesOf(asset).stream().mapToDouble(m -> lives.get(m.code()).used).max().orElse(0);
    }

    /** read one asset's sensors, judge them, and raise or clear its predictive alarm */
    private void read(Asset a) {
        Map<String, Life> mine = new LinkedHashMap<>();
        for (Mode m : EquipmentSimulator.modesOf(a.code())) mine.put(m.code(), lives.get(m.code()));
        double hour = LocalTime.now(ZONE).toSecondOfDay() / 3600.0;
        double ambient = 22 + 4 * Math.sin((hour - 9) / 24 * 2 * Math.PI) + random.nextGaussian() * 0.5;
        Map<String, Double> v = EquipmentSimulator.read(a, mine, ambient, 0.7 + 0.3 * random.nextDouble(), random);
        v.replaceAll((k, x) -> Math.round(x * 1000) / 1000.0);
        Deque<Map<String, Double>> d = recent.get(a.code());
        d.addLast(v);
        while (d.size() > PdmModel.WINDOW) d.removeFirst();
        PdmModel.Prediction p = null;
        PdmModel model = models.get(a.code());
        if (model != null && d.size() == PdmModel.WINDOW) p = model.predict(new ArrayList<>(d));
        if (p != null) lastPrediction.put(a.code(), p);
        double health = p == null ? 1 : health(p);
        db.update("INSERT INTO equipment_reading(at,asset_code,life_no,units,sensor_values,health,pred_mode,pred_prob,pred_rul,true_mode) VALUES (?,?,?,?,?,?,?,?,?,?)",
            Timestamp.from(Instant.now()), a.code(), lifeNo.get(a.code()), units(a.code()), json.writeValueAsString(v), health,
            p == null ? null : p.mode(), p == null ? null : p.probability(), p == null || Double.isNaN(p.remaining()) ? null : p.remaining(),
            EquipmentSimulator.degrading(mine));
        if (p != null) alarm(a, p);
    }

    /** 0-100 health: certainty of normal running, scaled down as the predicted remaining life runs out */
    static double health(PdmModel.Prediction p) {
        double normal = p.probs().getOrDefault("NORMAL", 0.0);
        if ("NORMAL".equals(p.mode())) return Math.round(Math.max(60, normal * 100));
        double rul = Double.isNaN(p.remaining()) ? 200 : p.remaining();
        return Math.round(Math.max(1, Math.min(59, rul / 200 * 59)));
    }

    private void alarm(Asset a, PdmModel.Prediction p) {
        List<Map<String, Object>> open = db.queryForList("SELECT * FROM pdm_alarm WHERE asset_code=? AND cleared_at IS NULL", a.code());
        boolean developing = !"NORMAL".equals(p.mode()) && p.probability() >= WARN_PROBABILITY;
        if (!developing) return; // an alarm stays until the asset is serviced, not until one calm reading
        String level = !Double.isNaN(p.remaining()) && p.remaining() <= ALERT_RUL ? "ALERT" : "WARN";
        if (open.isEmpty()) {
            db.update("INSERT INTO pdm_alarm(asset_code,mode_code,level,raised_at,raised_units,probability,rul_at_raise) VALUES (?,?,?,?,?,?,?)",
                a.code(), p.mode(), level, Timestamp.from(Instant.now()), units(a.code()), p.probability(), Double.isNaN(p.remaining()) ? null : p.remaining());
            mes.equipmentEvent("PDM_" + level, db.queryForObject("SELECT MAX(id) FROM pdm_alarm", Long.class));
        } else if ("ALERT".equals(level) && "WARN".equals(open.get(0).get("level"))) {
            db.update("UPDATE pdm_alarm SET level='ALERT', mode_code=? WHERE id=?", p.mode(), open.get(0).get("id"));
            mes.equipmentEvent("PDM_ALERT", ((Number) open.get(0).get("id")).longValue());
        }
    }

    private void fail(Mode m) {
        Asset a = EquipmentSimulator.asset(m.asset());
        List<Map<String, Object>> al = db.queryForList("SELECT * FROM pdm_alarm WHERE asset_code=? AND cleared_at IS NULL", a.code());
        Double lead = al.isEmpty() ? null : units(a.code()) - num(al.get(0).get("raised_units"));
        String predicted = al.isEmpty() ? null : String.valueOf(al.get(0).get("mode_code"));
        db.update("INSERT INTO equipment_fault(asset_code,mode_code,fault_code,kind,status,life_no,units,order_id,alarm_lead_units,predicted_mode,locked_at) " +
                "VALUES (?,?,?,'BREAKDOWN','LOCKED',?,?,?,?,?,?)", a.code(), m.code(), m.faultCode(), lifeNo.get(a.code()), units(a.code()),
            runningOrder(), lead, predicted, Timestamp.from(Instant.now()));
        try { plc.equipmentFault(m.faultCode()); } catch (Exception ignored) { }
        mes.equipmentEvent("EQUIPMENT_FAULT", db.queryForObject("SELECT MAX(id) FROM equipment_fault", Long.class));
    }

    private Long runningOrder() {
        List<Long> r = db.queryForList("SELECT id FROM mes_order WHERE status IN ('RUNNING','PAUSED') ORDER BY id DESC LIMIT 1", Long.class);
        return r.isEmpty() ? null : r.get(0);
    }

    private Integer openFaultCode() {
        List<Integer> r = db.queryForList("SELECT fault_code FROM equipment_fault WHERE status<>'CONFIRMED' ORDER BY id LIMIT 1", Integer.class);
        return r.isEmpty() ? null : r.get(0);
    }

    /** 예방 정비: the maintenance person takes an asset out of service before it fails (the line stops for it) */
    public synchronized Map<String, Object> preventive(String asset, String who) {
        EquipmentSimulator.asset(asset);
        if (openFaultCode() != null) throw new ResponseStatusException(HttpStatus.CONFLICT, "처리 중인 정비가 있습니다. 먼저 확인까지 마쳐 주세요.");
        List<Map<String, Object>> al = db.queryForList("SELECT * FROM pdm_alarm WHERE asset_code=? AND cleared_at IS NULL", asset);
        db.update("INSERT INTO equipment_fault(asset_code,mode_code,fault_code,kind,status,life_no,units,order_id,predicted_mode,locked_at,note) " +
                "VALUES (?,?,?,'PREVENTIVE','LOCKED',?,?,?,?,?,?)", asset, al.isEmpty() ? null : al.get(0).get("mode_code"),
            EquipmentSimulator.faultCodeOfPreventive(), lifeNo.get(asset), units(asset), runningOrder(),
            al.isEmpty() ? null : al.get(0).get("mode_code"), Timestamp.from(Instant.now()), "예방 정비 · " + who);
        try { plc.equipmentFault(EquipmentSimulator.faultCodeOfPreventive()); } catch (Exception ignored) { }
        mes.equipmentEvent("PREVENTIVE_LOCK", db.queryForObject("SELECT MAX(id) FROM equipment_fault", Long.class));
        return fault(db.queryForObject("SELECT MAX(id) FROM equipment_fault", Long.class));
    }

    /** 잠금 → 수리 */
    public synchronized Map<String, Object> startRepair(long id, String who) {
        Map<String, Object> f = fault(id);
        if (!"LOCKED".equals(f.get("status"))) throw new ResponseStatusException(HttpStatus.CONFLICT, "잠금 상태의 고장만 수리를 시작할 수 있습니다.");
        db.update("UPDATE equipment_fault SET status='REPAIRING', repair_started_at=?, repair_by=? WHERE id=?", Timestamp.from(Instant.now()), who, id);
        mes.equipmentEvent("REPAIR_STARTED", id);
        return fault(id);
    }

    /** 수리 → 확인: the part is renewed, the fault code cleared, and the line runs again */
    public synchronized Map<String, Object> confirm(long id, String who) {
        Map<String, Object> f = fault(id);
        if (!"REPAIRING".equals(f.get("status"))) throw new ResponseStatusException(HttpStatus.CONFLICT, "수리 중인 고장만 확인할 수 있습니다.");
        db.update("UPDATE equipment_fault SET status='CONFIRMED', confirmed_at=?, confirmed_by=? WHERE id=?", Timestamp.from(Instant.now()), who, id);
        String asset = String.valueOf(f.get("asset_code"));
        boolean breakdown = "BREAKDOWN".equals(f.get("kind"));
        // a breakdown renews the failed part; a preventive service renews every wearing part of the asset
        for (Mode m : EquipmentSimulator.modesOf(asset))
            if (!breakdown || m.code().equals(f.get("mode_code"))) {
                Life l = EquipmentSimulator.newLife(m, random);
                lives.put(m.code(), l);
                db.update("UPDATE equipment_life SET life=?, onset=?, used=0 WHERE mode_code=?", l.life, l.onset, m.code());
            }
        int next = lifeNo.get(asset) + 1;
        lifeNo.put(asset, next);
        db.update("UPDATE equipment_life SET life_no=? WHERE asset_code=?", next, asset);
        recent.get(asset).clear();
        lastPrediction.remove(asset);
        sinceReading.put(asset, 0.0);
        db.update("UPDATE pdm_alarm SET cleared_at=?, outcome=? WHERE asset_code=? AND cleared_at IS NULL",
            Timestamp.from(Instant.now()), breakdown ? "FAILED" : "PREVENTED", asset);
        mes.equipmentEvent("REPAIR_CONFIRMED", id);
        Integer still = openFaultCode();
        try {
            plc.equipmentFault(still == null ? 0 : still);
            if (still == null) plc.restartLine(); // only if the MES permit is on (an order is running)
        } catch (Exception ignored) { }
        if (breakdown) new Thread(() -> retrain("고장 " + f.get("mode_code") + " 확인 후")).start();
        return fault(id);
    }

    public Map<String, Object> fault(long id) {
        List<Map<String, Object>> r = db.queryForList("SELECT * FROM equipment_fault WHERE id=?", id);
        if (r.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "고장 기록이 없습니다.");
        return r.get(0);
    }

    /** the line's own run-to-failure records: readings of each asset life that ended in a confirmed breakdown */
    List<Reading> lineHistory() {
        List<Reading> out = new ArrayList<>();
        long cycle = 1_000_000;
        for (Map<String, Object> f : db.queryForList("SELECT * FROM equipment_fault WHERE kind='BREAKDOWN' AND status='CONFIRMED'")) {
            String asset = String.valueOf(f.get("asset_code")), mode = String.valueOf(f.get("mode_code"));
            double end = num(f.get("units"));
            // label from the maintenance record, as a plant would: the last stretch before the recorded failure belongs
            // to the failed mode, the rest is normal running
            double horizon = 0.3 * EquipmentSimulator.mode(mode).meanLife();
            cycle++;
            for (Map<String, Object> r : db.queryForList("SELECT units, sensor_values FROM equipment_reading WHERE asset_code=? AND life_no=? ORDER BY id",
                asset, ((Number) f.get("life_no")).intValue())) {
                double u = num(r.get("units"));
                out.add(new Reading(asset, cycle, u, values(String.valueOf(r.get("sensor_values"))), end - u <= horizon ? mode : null, end - u, true));
            }
        }
        return out;
    }

    /** train on the synthetic run-to-failure history plus everything the line itself has recorded */
    public void retrain(String why) {
        if (!training.compareAndSet(false, true)) return;
        try {
            long t0 = System.currentTimeMillis();
            List<Reading> synthetic = EquipmentSimulator.history(30, (int) SAMPLE_EVERY, 7);
            List<Reading> line = lineHistory();
            List<Reading> all = new ArrayList<>(synthetic);
            all.addAll(line);
            List<Reading> holdout = EquipmentSimulator.history(8, (int) SAMPLE_EVERY, 99);
            Map<String, PdmModel> next = new LinkedHashMap<>();
            Map<String, Object> perAsset = new LinkedHashMap<>();
            for (Asset a : EquipmentSimulator.ASSETS) {
                PdmModel m = new PdmModel(a);
                m.train(all);
                next.put(a.code(), m);
                perAsset.put(a.code(), PdmEvaluation.evaluate(m, holdout));
            }
            models = next;
            long lineLives = line.stream().map(Reading::cycle).distinct().count();
            Map<String, Object> info = new LinkedHashMap<>();
            info.put("version", "pdm-" + Instant.now().toString().substring(0, 16));
            info.put("trainedAt", Instant.now().toString());
            info.put("reason", why);
            info.put("syntheticLives", synthetic.stream().map(Reading::cycle).distinct().count());
            info.put("lineLives", lineLives);
            info.put("samples", all.size());
            info.put("trainMs", System.currentTimeMillis() - t0);
            info.put("holdout", perAsset);
            info.put("warnProbability", WARN_PROBABILITY);
            info.put("alertRul", ALERT_RUL);
            modelInfo = info;
            db.update("INSERT INTO pdm_model(trained_at,version,synthetic_lives,line_lives,metrics) VALUES (?,?,?,?,?)",
                Timestamp.from(Instant.now()), info.get("version"), ((Number) info.get("syntheticLives")).intValue(), (int) lineLives,
                json.writeValueAsString(perAsset));
        } finally { training.set(false); }
    }

    public synchronized void setSpeed(double s) {
        if (s < 1 || s > 50) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "배율은 1~50입니다.");
        speed = s;
        db.update("DELETE FROM app_setting WHERE setting_key='pdm.speed'");
        db.update("INSERT INTO app_setting(setting_key,setting_value) VALUES ('pdm.speed',?)", String.valueOf(s));
    }

    /** every asset with its state for the equipment page */
    public synchronized Map<String, Object> overview() {
        List<Map<String, Object>> assets = new ArrayList<>();
        List<Map<String, Object>> open = db.queryForList("SELECT * FROM equipment_fault WHERE status<>'CONFIRMED' ORDER BY id");
        for (Asset a : EquipmentSimulator.ASSETS) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("code", a.code());
            m.put("name", a.name());
            m.put("sensors", a.sensors());
            Deque<Map<String, Double>> d = recent.get(a.code());
            m.put("latest", d.isEmpty() ? null : d.getLast());
            PdmModel.Prediction p = lastPrediction.get(a.code());
            m.put("prediction", p);
            m.put("health", p == null ? null : health(p));
            List<Map<String, Object>> al = db.queryForList("SELECT * FROM pdm_alarm WHERE asset_code=? AND cleared_at IS NULL", a.code());
            m.put("alarm", al.isEmpty() ? null : al.get(0));
            m.put("fault", open.stream().filter(f -> a.code().equals(f.get("asset_code"))).findFirst().orElse(null));
            m.put("modes", EquipmentSimulator.modesOf(a.code()).stream().map(x -> Map.of("code", x.code(), "name", x.name())).toList());
            m.put("units", Math.round(units(a.code())));
            assets.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("assets", assets);
        out.put("openFault", open.isEmpty() ? null : open.get(0));
        out.put("speed", speed);
        out.put("model", modelInfo);
        out.put("modes", EquipmentSimulator.MODES.stream().map(x -> Map.of("code", x.code(), "name", x.name(), "asset", x.asset(), "faultCode", x.faultCode())).toList());
        return out;
    }

    public List<Map<String, Object>> readings(String asset, int limit) {
        return db.queryForList("SELECT at, units, sensor_values, health, pred_mode, pred_prob, pred_rul FROM equipment_reading WHERE asset_code=? ORDER BY id DESC LIMIT ?",
            asset, Math.max(1, Math.min(200, limit)));
    }

    /** test hook: wear a mode right to its end */
    synchronized void wearOut(String mode, double left) {
        Life l = lives.get(mode);
        l.used = Math.max(0, l.life - left);
    }
}
