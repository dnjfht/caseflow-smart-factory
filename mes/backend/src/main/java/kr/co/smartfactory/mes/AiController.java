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

    @GetMapping("/inspections")
    public List<Map<String, Object>> inspections(@RequestParam(defaultValue = "40") int limit,
                                                 @RequestParam(required = false) Long orderId) {
        int n = Math.max(1, Math.min(300, limit));
        return orderId == null
            ? db.queryForList("SELECT * FROM ai_inspection ORDER BY id DESC LIMIT ?", n)
            : db.queryForList("SELECT * FROM ai_inspection WHERE order_id = ? ORDER BY id DESC LIMIT ?", orderId, n);
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
        return m;
    }
}
