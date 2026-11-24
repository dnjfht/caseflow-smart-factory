package kr.co.smartfactory.mes;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * The line's equipment as a wear model, since the plant is virtual. Each piece of equipment has failure modes; every
 * case the line launches wears each mode a little (its life is drawn anew after each repair, so no two lives are the
 * same length). A mode shows nothing until it passes its own onset point P (somewhere at 45-65% of its life); from
 * there its sensor signature grows until the mode fails at 100% (F). Sensors also wander with ambient temperature and
 * load, and carry noise, so a reading alone is never the answer.
 * <p>
 * The same model drives the live line and generates the history the predictive model first learns from.
 */
public final class EquipmentSimulator {
    public record Sensor(String key, String name, String unit, double base, double noise) {}
    /** effect: sensor key -> change at full failure (in the sensor's unit) */
    public record Mode(String code, String name, String asset, int faultCode, double meanLife, Map<String, Double> effect) {}
    public record Asset(String code, String name, List<Sensor> sensors) {}

    public static final List<Asset> ASSETS = List.of(
        new Asset("BODY_CONVEYOR", "본체 공급 컨베이어", List.of(
            new Sensor("vibration", "진동", "mm/s", 2.2, 0.25), new Sensor("bearingTemp", "베어링 온도", "°C", 38, 1.2),
            new Sensor("current", "모터 전류", "A", 3.1, 0.12), new Sensor("beltSpeed", "벨트 속도비", "%", 100, 0.6))),
        new Asset("ROBOT", "Indy7 조립 로봇", List.of(
            new Sensor("torque", "관절 토크", "%", 46, 1.8), new Sensor("jointTemp", "관절 온도", "°C", 41, 1.0),
            new Sensor("posError", "위치 오차", "mm", 0.08, 0.015), new Sensor("cycle", "사이클 타임", "s", 6.4, 0.12))),
        new Asset("GRIPPER", "그리퍼", List.of(
            new Sensor("vacuum", "흡착 진공", "kPa", -72, 1.3), new Sensor("retries", "재파지 횟수", "회/10개", 0.3, 0.25))),
        new Asset("INSPECT_CONVEYOR", "검사 컨베이어", List.of(
            new Sensor("motorTemp", "모터 온도", "°C", 44, 1.1), new Sensor("current", "모터 전류", "A", 2.6, 0.1),
            new Sensor("vibration", "진동", "mm/s", 1.8, 0.2))),
        new Asset("SEALER", "포장 실링기", List.of(
            new Sensor("heaterDev", "히터 온도 편차", "°C", 1.5, 0.5), new Sensor("sealTime", "실링 시간", "s", 2.0, 0.05))));

    public static final List<Mode> MODES = List.of(
        new Mode("BEARING_WEAR", "베어링 마모", "BODY_CONVEYOR", 81, 520, Map.of("vibration", 7.5, "bearingTemp", 22.0, "current", 0.5)),
        new Mode("BELT_SLIP", "벨트 미끄러짐", "BODY_CONVEYOR", 82, 640, Map.of("beltSpeed", -14.0, "current", -0.35, "vibration", 1.2)),
        new Mode("REDUCER_WEAR", "감속기 마모", "ROBOT", 83, 700, Map.of("torque", 26.0, "posError", 0.42, "cycle", 0.5)),
        new Mode("JOINT_OVERHEAT", "관절 과열", "ROBOT", 84, 600, Map.of("jointTemp", 30.0, "cycle", 1.3, "torque", 6.0)),
        new Mode("VACUUM_LEAK", "진공 누설", "GRIPPER", 85, 460, Map.of("vacuum", 30.0, "retries", 4.5)),
        new Mode("MOTOR_OVERHEAT", "모터 과열", "INSPECT_CONVEYOR", 86, 680, Map.of("motorTemp", 34.0, "current", 1.1, "vibration", 1.0)),
        new Mode("HEATER_DEGRADATION", "히터 열화", "SEALER", 87, 560, Map.of("heaterDev", 11.0, "sealTime", 0.9)));

    public static Mode mode(String code) {
        return MODES.stream().filter(m -> m.code().equals(code)).findFirst().orElseThrow();
    }
    public static Asset asset(String code) {
        return ASSETS.stream().filter(a -> a.code().equals(code)).findFirst().orElseThrow();
    }
    public static List<Mode> modesOf(String asset) {
        return MODES.stream().filter(m -> m.asset().equals(asset)).toList();
    }
    public static int faultCodeOfPreventive() { return 90; }

    /** one life of one mode: how long it lasts, and where its signature starts to show */
    public static final class Life {
        public double life;   // cases until failure
        public double onset;  // fraction of life where the signature starts (P)
        public double used;   // cases so far
        public Life(double life, double onset, double used) { this.life = life; this.onset = onset; this.used = used; }
        public double wear() { return used / life; }
        /** 0 before P, rising to 1 at F (quadratic: slow at first, then fast - like real degradation) */
        public double severity() {
            double w = wear();
            if (w <= onset) return 0;
            double x = Math.min(1, (w - onset) / (1 - onset));
            return x * x;
        }
        public double remaining() { return Math.max(0, life - used); }
    }

    public static Life newLife(Mode m, Random r) {
        // life spread like a wear-out distribution: most lives near the mean, a few short or long
        double life = m.meanLife() * Math.max(0.55, 1 + 0.22 * r.nextGaussian());
        return new Life(life, 0.45 + 0.2 * r.nextDouble(), 0);
    }

    /** a reading of one asset's sensors given the state of its modes, the ambient temperature and the load */
    public static Map<String, Double> read(Asset a, Map<String, Life> lives, double ambient, double load, Random r) {
        Map<String, Double> v = new LinkedHashMap<>();
        for (Sensor s : a.sensors()) {
            double x = s.base() + r.nextGaussian() * s.noise();
            if (s.unit().equals("°C")) x += (ambient - 22) * 0.6;          // hotter plant, hotter motors
            if (s.key().equals("current") || s.key().equals("torque")) x *= 0.9 + 0.2 * load;
            v.put(s.key(), x);
        }
        for (Mode m : modesOf(a.code())) {
            Life l = lives.get(m.code());
            if (l == null) continue;
            double sev = l.severity();
            for (var e : m.effect().entrySet()) v.merge(e.getKey(), e.getValue() * sev * (0.85 + 0.3 * r.nextDouble()), Double::sum);
        }
        return v;
    }

    /** a recorded reading with the truth behind it (the model never sees the truth columns as inputs) */
    public record Reading(String asset, long cycle, double units, Map<String, Double> values,
                          String degrading, double remaining, boolean failedAfter) {}

    /**
     * Run-to-failure history: for each mode, {@code lives} lives on its asset, sampled every {@code every} cases.
     * Each sample is labelled with the mode that is past its onset (if any) and the cases left until that asset's next
     * failure. This is what the first model learns from before the line has any history of its own.
     */
    public static List<Reading> history(int lives, int every, long seed) {
        Random r = new Random(seed);
        List<Reading> out = new ArrayList<>();
        long cycle = 0;
        for (Asset a : ASSETS) {
            List<Mode> ms = modesOf(a.code());
            for (int k = 0; k < lives * ms.size(); k++) {
                cycle++;
                Map<String, Life> lives_ = new LinkedHashMap<>();
                for (Mode m : ms) lives_.put(m.code(), newLife(m, r));
                // run until the first mode fails: that is this life's end
                double units = 0;
                List<Reading> life = new ArrayList<>();
                while (true) {
                    double ambient = 22 + 5 * Math.sin(units / 90.0) + r.nextGaussian();
                    double load = 0.7 + 0.3 * r.nextDouble();
                    Map<String, Double> v = read(a, lives_, ambient, load, r);
                    life.add(new Reading(a.code(), cycle, units, v, degrading(lives_), 0, false));
                    boolean failed = false;
                    for (Life l : lives_.values()) { l.used += every; if (l.used >= l.life) failed = true; }
                    units += every;
                    if (failed) break;
                }
                for (Reading x : life) out.add(new Reading(x.asset(), x.cycle(), x.units(), x.values(), x.degrading(), units - x.units(), true));
            }
        }
        return out;
    }

    static final double SHOWING = 0.04;

    /** the mode furthest past its onset, or null if none is showing yet */
    public static String degrading(Map<String, Life> lives) {
        // a mode counts as showing once its signature is a few percent of what it will be at failure:
        // right at the onset the change is far below the sensor noise, so no model could see it
        String best = null;
        double worst = SHOWING;
        for (var e : lives.entrySet()) {
            double s = e.getValue().severity();
            if (s > worst) { worst = s; best = e.getKey(); }
        }
        return best;
    }
}
