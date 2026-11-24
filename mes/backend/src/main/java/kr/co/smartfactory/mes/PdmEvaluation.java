package kr.co.smartfactory.mes;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import kr.co.smartfactory.mes.EquipmentSimulator.Reading;

/**
 * How the model would have done on lives it never saw, judged the way the line uses it: does it name the developing
 * cause, how far off is its remaining-life estimate, and - per life - how many cases before the failure the 주의 and
 * 정비 권장 alarms would have come, and how often it alarms while the equipment is still healthy.
 */
public final class PdmEvaluation {
    private PdmEvaluation() { }

    public static Map<String, Object> evaluate(PdmModel m, List<Reading> holdout) {
        return evaluate(m, holdout, EquipmentService.WARN_PROBABILITY, EquipmentService.ALERT_RUL);
    }

    public static Map<String, Object> evaluate(PdmModel m, List<Reading> holdout, double warnP, double alertRul) {
        Map<Long, List<Reading>> lives = new LinkedHashMap<>();
        for (Reading r : holdout) if (r.asset().equals(m.asset.code())) lives.computeIfAbsent(r.cycle(), k -> new ArrayList<>()).add(r);
        int correct = 0, n = 0, rulN = 0, normalN = 0, falseAlarms = 0, alerted = 0, warned = 0, rightCause = 0;
        double rulErr = 0, warnLead = 0, alertLead = 0;
        List<Double> alertLeads = new ArrayList<>();
        for (List<Reading> life : lives.values()) {
            Double firstWarn = null, firstAlert = null;
            String warnCause = null, truth = life.get(life.size() - 1).degrading();
            for (int i = PdmModel.WINDOW - 1; i < life.size(); i++) {
                List<Map<String, Double>> win = new ArrayList<>();
                for (int k = i - PdmModel.WINDOW + 1; k <= i; k++) win.add(life.get(k).values());
                Reading cur = life.get(i);
                PdmModel.Prediction p = m.predict(win);
                String label = cur.degrading() == null ? "NORMAL" : cur.degrading();
                n++;
                if (label.equals(p.mode())) correct++;
                if (!"NORMAL".equals(label) && !Double.isNaN(p.remaining())) { rulErr += Math.abs(p.remaining() - cur.remaining()); rulN++; }
                boolean developing = !"NORMAL".equals(p.mode()) && p.probability() >= warnP;
                if ("NORMAL".equals(label)) { normalN++; if (developing) falseAlarms++; }
                if (developing && firstWarn == null) { firstWarn = cur.remaining(); warnCause = p.mode(); }
                if (developing && !Double.isNaN(p.remaining()) && p.remaining() <= alertRul && firstAlert == null) firstAlert = cur.remaining();
            }
            if (firstWarn != null) { warned++; warnLead += firstWarn; if (warnCause.equals(truth)) rightCause++; }
            if (firstAlert != null) { alerted++; alertLead += firstAlert; alertLeads.add(firstAlert); }
        }
        alertLeads.sort(Double::compare);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("lives", lives.size());
        out.put("accuracy", round((double) correct / Math.max(1, n)));
        out.put("rulMae", round(rulErr / Math.max(1, rulN)));
        out.put("falseAlarmRate", round((double) falseAlarms / Math.max(1, normalN)));
        out.put("warnedLives", round((double) warned / Math.max(1, lives.size())));
        out.put("warnLead", round(warnLead / Math.max(1, warned)));
        out.put("warnCauseRight", round((double) rightCause / Math.max(1, warned)));
        out.put("alertedLives", round((double) alerted / Math.max(1, lives.size())));
        out.put("alertLead", round(alertLead / Math.max(1, alerted)));
        out.put("alertLeadMin", alertLeads.isEmpty() ? null : round(alertLeads.get(0)));
        return out;
    }

    static double round(double x) { return Math.round(x * 1000) / 1000.0; }
}
