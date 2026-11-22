package kr.co.smartfactory.mes;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.InputStream;
import java.nio.FloatBuffer;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import javax.imageio.ImageIO;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * The vision inspection station. When a case reaches the inspection cell the line asks for a verdict: the station
 * takes a camera image of the case (here, an image drawn at random from the held-out production pool, which the model
 * never saw in training, defective with the configured rate), runs the defect-cause model on it and returns pass or
 * reject together with the cause. Every judgement is stored with the image's true label so the MES can show how the
 * model is doing on the line, not only on its test set.
 * <p>
 * The model and every number it is judged by come from {@code ai/model.json}, written by the training script.
 */
@Component
public class AiInspector {
    public record Verdict(long id, int seq, String image, String trueLabel, String predLabel, String cause, boolean good,
        double pDefect, double confidence, Map<String, Double> probs, long latencyMs, Instant at) {}

    private final JdbcTemplate db;
    private final Random random = new Random();
    private final ObjectMapper json = new ObjectMapper();
    private JsonNode card;
    private List<String> classes = List.of();
    private List<String[]> pool = List.of(); // [file, trueLabel]
    private OrtEnvironment env;
    private OrtSession session;
    private int size;
    private float[] mean, std;
    private double temperature = 1, tau = 0.5, causeMin = 0.5, defectRate = 0.2;
    private String failure;

    public AiInspector(JdbcTemplate db) {
        this.db = db;
        try {
            card = json.readTree(resource("ai/model.json"));
            classes = new ArrayList<>();
            card.get("classes").forEach(c -> classes.add(c.asString()));
            size = card.get("input_size").asInt();
            mean = floats(card.get("mean"));
            std = floats(card.get("std"));
            temperature = card.get("temperature").asDouble();
            tau = card.get("threshold").get("reject_p_defect").asDouble();
            causeMin = card.get("threshold").get("cause_min_confidence").asDouble();
            defectRate = card.path("production").path("defect_rate").asDouble(0.2);
            List<String[]> p = new ArrayList<>();
            for (String line : new String(resource("ai/pool.csv").readAllBytes()).split("\n")) {
                String[] f = line.trim().split(",");
                if (f.length == 2) p.add(f);
            }
            pool = p;
            env = OrtEnvironment.getEnvironment();
            OrtSession.SessionOptions options = new OrtSession.SessionOptions();
            options.setIntraOpNumThreads(1); // one case at a time, ~10 ms: no thread pool to keep in the free server's 512 MB
            session = env.createSession(resource("ai/model.onnx").readAllBytes(), options);
            infer(read(pool.get(0)[0])); // warm up: the first run allocates
        } catch (Exception | LinkageError e) {
            failure = e.toString();
            session = null;
        }
    }

    private static InputStream resource(String name) {
        InputStream in = AiInspector.class.getClassLoader().getResourceAsStream(name);
        if (in == null) throw new IllegalStateException("missing " + name);
        return in;
    }

    private static float[] floats(JsonNode a) {
        float[] f = new float[a.size()];
        for (int i = 0; i < f.length; i++) f[i] = (float) a.get(i).asDouble();
        return f;
    }

    public boolean ready() { return session != null; }
    public String failure() { return failure; }
    public JsonNode card() { return card; }

    public static BufferedImage read(String file) throws Exception {
        try (InputStream in = resource("ai/pool/" + file)) { return ImageIO.read(in); }
    }

    public static byte[] bytes(String file) throws Exception {
        try (InputStream in = resource("ai/pool/" + file)) { return in.readAllBytes(); }
    }

    /** class probabilities for one image, temperature-calibrated */
    synchronized double[] infer(BufferedImage src) throws Exception {
        BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.drawImage(src, 0, 0, size, size, null);
        g.dispose();
        float[] x = new float[3 * size * size];
        int plane = size * size;
        for (int y = 0; y < size; y++)
            for (int xx = 0; xx < size; xx++) {
                int rgb = img.getRGB(xx, y), o = y * size + xx;
                x[o] = (((rgb >> 16) & 255) / 255f - mean[0]) / std[0];
                x[plane + o] = (((rgb >> 8) & 255) / 255f - mean[1]) / std[1];
                x[2 * plane + o] = ((rgb & 255) / 255f - mean[2]) / std[2];
            }
        try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(x), new long[] {1, 3, size, size});
             OrtSession.Result r = session.run(Map.of(session.getInputNames().iterator().next(), t))) {
            float[] logits = ((float[][]) r.get(0).getValue())[0];
            double max = Double.NEGATIVE_INFINITY;
            for (float l : logits) max = Math.max(max, l / temperature);
            double[] p = new double[logits.length];
            double sum = 0;
            for (int i = 0; i < p.length; i++) sum += p[i] = Math.exp(logits[i] / temperature - max);
            for (int i = 0; i < p.length; i++) p[i] /= sum;
            return p;
        }
    }

    /** the inspection camera's next shot: a case off the line, defective at the configured rate */
    String[] nextCase() {
        boolean defective = random.nextDouble() < defectRate;
        List<String[]> pick = pool.stream().filter(f -> defective != "OK".equals(f[1])).toList();
        return pick.get(random.nextInt(pick.size()));
    }

    /** judge the case at the inspection cell and record it against the running order */
    public Verdict inspect(String source) throws Exception {
        if (session == null) throw new IllegalStateException("AI 모델이 없습니다: " + failure);
        String[] c = nextCase();
        long t0 = System.nanoTime();
        double[] p = infer(read(c[0]));
        long ms = (System.nanoTime() - t0) / 1_000_000;
        double pDefect = 1 - p[0];
        boolean good = pDefect < tau;
        int top = 0, cause = 1;
        for (int i = 0; i < p.length; i++) if (p[i] > p[top]) top = i;
        for (int i = 1; i < p.length; i++) if (p[i] > p[cause]) cause = i;
        // a rejected case names its cause only when the model is sure enough of it; otherwise it goes to manual review
        String causeLabel = good ? "OK" : p[cause] / pDefect >= causeMin ? classes.get(cause) : "UNSURE";
        Map<String, Double> probs = new java.util.LinkedHashMap<>();
        for (int i = 0; i < p.length; i++) probs.put(classes.get(i), Math.round(p[i] * 10000) / 10000.0);
        Instant at = Instant.now();
        Long orderId = db.query("SELECT id FROM mes_order WHERE status IN ('RUNNING','PAUSED') ORDER BY id DESC LIMIT 1",
            rs -> rs.next() ? rs.getLong(1) : null);
        Integer seq = db.queryForObject("SELECT COUNT(*) FROM ai_inspection WHERE order_id " + (orderId == null ? "IS NULL" : "= " + orderId), Integer.class);
        int n = (seq == null ? 0 : seq) + 1;
        db.update("INSERT INTO ai_inspection(inspected_at,order_id,seq,source,image,true_label,pred_label,cause,verdict_good," +
                "p_defect,confidence,probs,threshold,model_version,latency_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            Timestamp.from(at), orderId, n, source, c[0], c[1], classes.get(top), causeLabel, good, pDefect, p[top],
            json.writeValueAsString(probs), tau, card.get("version").asString(), ms);
        Long id = db.queryForObject("SELECT MAX(id) FROM ai_inspection", Long.class);
        return new Verdict(id == null ? 0 : id, n, c[0], c[1], classes.get(top), causeLabel, good, pDefect, p[top], probs, ms, at);
    }
}
