package kr.co.smartfactory.mes;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import kr.co.smartfactory.mes.EquipmentSimulator.Asset;
import kr.co.smartfactory.mes.EquipmentSimulator.Mode;
import kr.co.smartfactory.mes.EquipmentSimulator.Reading;
import kr.co.smartfactory.mes.EquipmentSimulator.Sensor;
import org.junit.jupiter.api.Test;

/**
 * Is the model worth having? It is compared, on the same lives it never saw, with what a plant would do without it:
 * (1) a fixed limit alarm on each sensor (base ± 3·noise, two readings in a row) that names the cause by the sensor
 * that left its band, and (2) time-based replacement at 70% of the asset's shortest mean life.
 * The printout is the table in the guide (chapter 13).
 */
class PdmBaselineEval {
    static final double K = 3;

    record Row(double warned, double lead, double falseRate, double causeRight) {}

    static Row limitAlarm(Asset a, List<List<Reading>> lives) {
        int warned = 0, normalN = 0, falseN = 0, right = 0;
        double lead = 0;
        for (List<Reading> life : lives) {
            String truth = life.get(life.size() - 1).degrading();
            boolean prev = false, done = false;
            for (Reading r : life) {
                Sensor worst = null;
                double worstZ = 0;
                for (Sensor s : a.sensors()) {
                    double z = Math.abs(r.values().get(s.key()) - s.base()) / s.noise();
                    if (z > worstZ) { worstZ = z; worst = s; }
                }
                boolean out = worstZ > K, alarm = out && prev;
                prev = out;
                if (r.degrading() == null) { normalN++; if (alarm) falseN++; }
                if (alarm && !done) {
                    done = true;
                    warned++;
                    lead += r.remaining();
                    final Sensor w = worst;
                    double dir = r.values().get(w.key()) - w.base();
                    String cause = EquipmentSimulator.modesOf(a.code()).stream()
                        .max((x, y) -> Double.compare(Math.signum(dir) * x.effect().getOrDefault(w.key(), 0.0) / w.noise(),
                            Math.signum(dir) * y.effect().getOrDefault(w.key(), 0.0) / w.noise())).map(Mode::code).orElse(null);
                    if (cause != null && cause.equals(truth)) right++;
                }
            }
        }
        return new Row((double) warned / lives.size(), lead / Math.max(1, warned), (double) falseN / Math.max(1, normalN), (double) right / Math.max(1, warned));
    }

    @Test
    void modelBeatsTheLimitAlarm() {
        List<Reading> train = EquipmentSimulator.history(30, 4, 7), holdout = EquipmentSimulator.history(8, 4, 99);
        System.out.println("asset | limit: warned lead false cause | model: warned lead false cause | time-PM: avoided wasted | model-PM: avoided wasted");
        double limitFalse = 0, modelFalse = 0, limitCause = 0, modelCause = 0;
        for (Asset a : EquipmentSimulator.ASSETS) {
            Map<Long, List<Reading>> by = new LinkedHashMap<>();
            for (Reading r : holdout) if (r.asset().equals(a.code())) by.computeIfAbsent(r.cycle(), k -> new ArrayList<>()).add(r);
            List<List<Reading>> lives = new ArrayList<>(by.values());
            Row lim = limitAlarm(a, lives);
            PdmModel m = new PdmModel(a);
            m.train(train);
            Map<String, Object> ev = PdmEvaluation.evaluate(m, holdout);
            // time-based: replace at 70% of the shortest mean life of the asset's modes
            double interval = 0.7 * EquipmentSimulator.modesOf(a.code()).stream().mapToDouble(Mode::meanLife).min().orElse(0);
            int avoided = 0;
            double wasted = 0;
            for (List<Reading> life : lives) {
                double end = life.get(0).remaining(); // units from the first reading to the failure = the life length
                if (end > interval) { avoided++; wasted += end - interval; }
            }
            double mAvoided = num(ev.get("alertedLives")), mWasted = num(ev.get("alertLead"));
            System.out.printf("%s | %.2f %.0f %.3f %.2f | %.2f %.0f %.3f %.2f | %.2f %.0f | %.2f %.0f%n", a.code(),
                lim.warned(), lim.lead(), lim.falseRate(), lim.causeRight(),
                num(ev.get("warnedLives")), num(ev.get("warnLead")), num(ev.get("falseAlarmRate")), num(ev.get("warnCauseRight")),
                (double) avoided / lives.size(), wasted / Math.max(1, avoided), mAvoided, mWasted);
            limitFalse += lim.falseRate(); modelFalse += num(ev.get("falseAlarmRate"));
            limitCause += lim.causeRight(); modelCause += num(ev.get("warnCauseRight"));
        }
        assertThat(modelFalse).isLessThanOrEqualTo(limitFalse);
        assertThat(modelCause).isGreaterThanOrEqualTo(limitCause);
    }

    static double num(Object o) { return o == null ? 0 : ((Number) o).doubleValue(); }
}
