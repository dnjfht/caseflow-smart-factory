package kr.co.smartfactory.mes;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** The vision AI as the MES shows it: the model card, each judgement on the line, and how right it has been there. */
@RestController
@RequestMapping("/api/ai")
public class AiController {
    private final AiInspector ai;
    private final JdbcTemplate db;

    public AiController(AiInspector ai, JdbcTemplate db) { this.ai = ai; this.db = db; }

    @GetMapping("/model")
    public Map<String, Object> model() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ready", ai.ready());
        m.put("failure", ai.failure());
        m.put("card", ai.card());
        return m;
    }

    /** the inspection log, one page at a time, for one work order or all; verdict GOOD / NG narrows it */
    @GetMapping("/inspections")
    public Map<String, Object> inspections(@RequestParam(defaultValue = "10") int limit,
                                           @RequestParam(defaultValue = "0") int offset,
                                           @RequestParam(required = false) Long orderId,
                                           @RequestParam(required = false) String verdict) {
        int n = Math.max(1, Math.min(100, limit)), from = Math.max(0, offset);
        List<Object> args = new java.util.ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        if (orderId != null) { where.append(" AND a.order_id = ?"); args.add(orderId); }
        if ("GOOD".equals(verdict)) where.append(" AND a.verdict_good = TRUE");
        if ("NG".equals(verdict)) where.append(" AND a.verdict_good = FALSE");
        Integer total = db.queryForObject("SELECT COUNT(*) FROM ai_inspection a" + where, Integer.class, args.toArray());
        List<Object> page = new java.util.ArrayList<>(args);
        page.add(n);
        page.add(from);
        List<Map<String, Object>> rows = db.queryForList("SELECT a.id, a.inspected_at, a.order_id, o.order_code, a.seq, a.image, " +
            "a.true_label, a.pred_label, a.cause, a.verdict_good, a.p_defect, a.confidence, a.probs, a.threshold, a.model_version, a.latency_ms " +
            "FROM ai_inspection a LEFT JOIN mes_order o ON o.id = a.order_id" + where + " ORDER BY a.id DESC LIMIT ? OFFSET ?", page.toArray());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("total", total == null ? 0 : total);
        m.put("rows", rows);
        return m;
    }

    /** per work order: how many cases were judged, how many rejected, and for what cause - newest orders first */
    @GetMapping("/by-order")
    public List<Map<String, Object>> byOrder(@RequestParam(defaultValue = "8") int limit) {
        List<Map<String, Object>> orders = db.queryForList("SELECT a.order_id, o.order_code, COUNT(*) AS total, " +
            "SUM(CASE WHEN a.verdict_good THEN 0 ELSE 1 END) AS defects, MAX(a.id) AS last_id FROM ai_inspection a " +
            "JOIN mes_order o ON o.id = a.order_id GROUP BY a.order_id, o.order_code ORDER BY MAX(a.id) DESC LIMIT ?",
            Math.max(1, Math.min(50, limit)));
        List<Map<String, Object>> out = new java.util.ArrayList<>();
        for (Map<String, Object> o : orders) {
            Object id = o.get("order_id") != null ? o.get("order_id") : o.get("ORDER_ID");
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("orderId", id);
            m.put("orderCode", o.get("order_code") != null ? o.get("order_code") : o.get("ORDER_CODE"));
            m.put("total", ((Number) (o.get("total") != null ? o.get("total") : o.get("TOTAL"))).intValue());
            m.put("defects", ((Number) (o.get("defects") != null ? o.get("defects") : o.get("DEFECTS"))).intValue());
            m.put("byCause", causes(" WHERE verdict_good = FALSE AND order_id = ?", id));
            out.add(m);
        }
        return out;
    }

    private Map<String, Integer> causes(String where, Object... args) {
        Map<String, Integer> m = new LinkedHashMap<>();
        for (Map<String, Object> r : db.queryForList("SELECT cause, COUNT(*) AS n FROM ai_inspection" + where + " GROUP BY cause ORDER BY COUNT(*) DESC", args))
            m.put(String.valueOf(r.get("cause") != null ? r.get("cause") : r.get("CAUSE")), ((Number) (r.get("n") != null ? r.get("n") : r.get("N"))).intValue());
        return m;
    }

    /** the camera image of one judged case */
    @GetMapping(value = "/image/{file}", produces = MediaType.IMAGE_JPEG_VALUE)
    public ResponseEntity<byte[]> image(@PathVariable String file) throws Exception {
        if (!file.matches("[A-Z_]+_\\d+\\.jpg")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        return ResponseEntity.ok().header("Cache-Control", "max-age=86400").body(AiInspector.bytes(file));
    }

    /** the model on the line: every case it judged against what the case really was */
    @GetMapping("/live")
    public Map<String, Object> live(@RequestParam(required = false) Long orderId) {
        String where = orderId == null ? "" : " WHERE order_id = " + orderId;
        List<Map<String, Object>> rows = db.queryForList("SELECT true_label, pred_label, cause, verdict_good, latency_ms FROM ai_inspection" + where);
        int total = rows.size(), correct = 0, defects = 0, escaped = 0, goods = 0, falseReject = 0, rejectedDefects = 0, causeRight = 0, unsure = 0;
        long latency = 0;
        Map<String, Map<String, Integer>> confusion = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            String truth = String.valueOf(r.get("true_label")), pred = String.valueOf(r.get("pred_label")), cause = String.valueOf(r.get("cause"));
            boolean good = Boolean.TRUE.equals(r.get("verdict_good"));
            latency += ((Number) r.get("latency_ms")).longValue();
            if (truth.equals(pred)) correct++;
            confusion.computeIfAbsent(truth, k -> new LinkedHashMap<>()).merge(pred, 1, Integer::sum);
            if ("OK".equals(truth)) { goods++; if (!good) falseReject++; }
            else {
                defects++;
                if (good) escaped++;
                else { rejectedDefects++; if (truth.equals(cause)) causeRight++; if ("UNSURE".equals(cause)) unsure++; }
            }
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("total", total);
        m.put("accuracy", total == 0 ? null : (double) correct / total);
        m.put("defects", defects);
        m.put("escaped", escaped);
        m.put("goods", goods);
        m.put("falseReject", falseReject);
        m.put("causeAccuracy", rejectedDefects == 0 ? null : (double) causeRight / rejectedDefects);
        m.put("unsure", unsure);
        m.put("avgLatencyMs", total == 0 ? null : (double) latency / total);
        m.put("confusion", confusion);
        m.put("rejected", rows.stream().filter(r -> !Boolean.TRUE.equals(r.get("verdict_good"))).count());
        m.put("byCause", orderId == null ? causes(" WHERE verdict_good = FALSE") : causes(" WHERE verdict_good = FALSE AND order_id = ?", orderId));
        return m;
    }
}
