package kr.co.smartfactory.mes;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import kr.co.smartfactory.mes.EquipmentSimulator.Asset;
import kr.co.smartfactory.mes.EquipmentSimulator.Reading;
import kr.co.smartfactory.mes.EquipmentSimulator.Sensor;

/**
 * The predictive-maintenance model, one per asset, small enough to retrain on the server in a second:
 * <ul>
 *   <li><b>cause</b>: multinomial logistic regression - NORMAL or which failure mode is developing</li>
 *   <li><b>remaining life</b>: ridge regression per mode - cases left until that mode fails</li>
 * </ul>
 * Inputs are made from the last few readings of the asset: each sensor's level (as standard scores against the
 * asset's normal readings) averaged over a window, its square root (degradation grows faster than linear, so the root
 * of the signature tracks the remaining life more evenly), and its trend (slope over the window).
 */
public final class PdmModel {
    public static final int WINDOW = 6;

    public record Prediction(String asset, String mode, double probability, double remaining, Map<String, Double> probs) {}

    final Asset asset;
    final List<String> classes = new ArrayList<>();
    double[] mean, std;            // normal reading level per sensor
    double[][] w;                  // classifier weights [class][feature+1]
    final Map<String, double[]> rul = new LinkedHashMap<>(); // ridge weights per mode

    PdmModel(Asset asset) {
        this.asset = asset;
        classes.add("NORMAL");
        EquipmentSimulator.modesOf(asset.code()).forEach(m -> classes.add(m.code()));
    }

    int sensors() { return asset.sensors().size(); }

    /** features from the last WINDOW readings (oldest first) */
    double[] features(List<Map<String, Double>> window) {
        int s = sensors(), n = window.size();
        double[] f = new double[3 * s];
        for (int i = 0; i < s; i++) {
            Sensor sen = asset.sensors().get(i);
            double sum = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
            for (int t = 0; t < n; t++) {
                double z = (window.get(t).get(sen.key()) - mean[i]) / std[i];
                sum += z; sx += t; sy += z; sxx += t * t; sxy += t * z;
            }
            double avg = sum / n;
            f[i] = avg;
            f[s + i] = Math.signum(avg) * Math.sqrt(Math.abs(avg));
            double den = n * sxx - sx * sx;
            f[2 * s + i] = den == 0 ? 0 : (n * sxy - sx * sy) / den;
        }
        return f;
    }

    public record Sample(double[] x, int cls, double remaining) {}

    /** windows over each recorded life, in order */
    List<Sample> samples(List<Reading> readings) {
        List<Sample> out = new ArrayList<>();
        Map<Long, List<Reading>> lives = new LinkedHashMap<>();
        for (Reading r : readings) if (r.asset().equals(asset.code())) lives.computeIfAbsent(r.cycle(), k -> new ArrayList<>()).add(r);
        for (List<Reading> life : lives.values())
            for (int i = WINDOW - 1; i < life.size(); i++) {
                List<Map<String, Double>> win = new ArrayList<>();
                for (int k = i - WINDOW + 1; k <= i; k++) win.add(life.get(k).values());
                Reading cur = life.get(i);
                int cls = cur.degrading() == null ? 0 : classes.indexOf(cur.degrading());
                out.add(new Sample(features(win), Math.max(0, cls), cur.failedAfter() ? cur.remaining() : Double.NaN));
            }
        return out;
    }

    /** fit everything from run-to-failure readings */
    void train(List<Reading> readings) {
        int s = sensors();
        mean = new double[s]; std = new double[s];
        List<Reading> normal = readings.stream().filter(r -> r.asset().equals(asset.code()) && r.degrading() == null).toList();
        for (int i = 0; i < s; i++) {
            String k = asset.sensors().get(i).key();
            double m = normal.stream().mapToDouble(r -> r.values().get(k)).average().orElse(0);
            double v = normal.stream().mapToDouble(r -> Math.pow(r.values().get(k) - m, 2)).average().orElse(1);
            mean[i] = m; std[i] = Math.max(1e-6, Math.sqrt(v));
        }
        List<Sample> data = samples(readings);
        fitClassifier(data);
        for (int c = 1; c < classes.size(); c++) {
            final int cc = c;
            List<Sample> d = data.stream().filter(x -> x.cls() == cc && !Double.isNaN(x.remaining())).toList();
            rul.put(classes.get(c), ridge(d, 1.0));
        }
    }

    private void fitClassifier(List<Sample> data) {
        int k = classes.size(), d = 3 * sensors() + 1;
        w = new double[k][d];
        int[] count = new int[k];
        for (Sample x : data) count[x.cls()]++;
        double[] weight = new double[k]; // balance classes: a developing fault is rarer than normal running
        for (int c = 0; c < k; c++) weight[c] = count[c] == 0 ? 0 : (double) data.size() / (k * count[c]);
        double lr = 0.3, l2 = 1e-3;
        for (int epoch = 0; epoch < 250; epoch++) {
            double[][] g = new double[k][d];
            for (Sample x : data) {
                double[] p = softmax(x.x());
                for (int c = 0; c < k; c++) {
                    double e = (p[c] - (c == x.cls() ? 1 : 0)) * weight[x.cls()];
                    for (int j = 0; j < d - 1; j++) g[c][j] += e * x.x()[j];
                    g[c][d - 1] += e;
                }
            }
            for (int c = 0; c < k; c++) for (int j = 0; j < d; j++) w[c][j] -= lr * (g[c][j] / data.size() + l2 * w[c][j]);
        }
    }

    double[] softmax(double[] x) {
        int k = classes.size(), d = x.length;
        double[] z = new double[k];
        double max = Double.NEGATIVE_INFINITY;
        for (int c = 0; c < k; c++) {
            double s = w[c][d];
            for (int j = 0; j < d; j++) s += w[c][j] * x[j];
            z[c] = s; max = Math.max(max, s);
        }
        double sum = 0;
        for (int c = 0; c < k; c++) sum += z[c] = Math.exp(z[c] - max);
        for (int c = 0; c < k; c++) z[c] /= sum;
        return z;
    }

    /** ridge regression with intercept, solved by the normal equations */
    static double[] ridge(List<Sample> d, double lambda) {
        if (d.isEmpty()) return null;
        int n = d.get(0).x().length + 1;
        double[][] a = new double[n][n + 1];
        for (Sample s : d) {
            double[] x = new double[n];
            System.arraycopy(s.x(), 0, x, 0, n - 1);
            x[n - 1] = 1;
            for (int i = 0; i < n; i++) {
                for (int j = 0; j < n; j++) a[i][j] += x[i] * x[j];
                a[i][n] += x[i] * s.remaining();
            }
        }
        for (int i = 0; i < n - 1; i++) a[i][i] += lambda;
        for (int c = 0; c < n; c++) { // Gauss-Jordan
            int p = c;
            for (int r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
            double[] t = a[c]; a[c] = a[p]; a[p] = t;
            if (Math.abs(a[c][c]) < 1e-12) continue;
            for (int r = 0; r < n; r++) if (r != c) {
                double f = a[r][c] / a[c][c];
                for (int j = c; j <= n; j++) a[r][j] -= f * a[c][j];
            }
        }
        double[] b = new double[n];
        for (int i = 0; i < n; i++) b[i] = Math.abs(a[i][i]) < 1e-12 ? 0 : a[i][n] / a[i][i];
        return b;
    }

    static double apply(double[] b, double[] x) {
        double s = b[b.length - 1];
        for (int i = 0; i < x.length; i++) s += b[i] * x[i];
        return s;
    }

    public Prediction predict(List<Map<String, Double>> window) {
        double[] x = features(window);
        double[] p = softmax(x);
        int best = 0;
        for (int c = 1; c < p.length; c++) if (p[c] > p[best]) best = c;
        // the most likely developing mode, even when NORMAL leads (so the page can say what to watch)
        int fault = 1;
        for (int c = 2; c < p.length; c++) if (p[c] > p[fault]) fault = c;
        double[] b = rul.get(classes.get(fault));
        double remaining = b == null ? Double.NaN : Math.max(0, apply(b, x));
        Map<String, Double> probs = new LinkedHashMap<>();
        for (int c = 0; c < p.length; c++) probs.put(classes.get(c), Math.round(p[c] * 1000) / 1000.0);
        return new Prediction(asset.code(), best == 0 ? "NORMAL" : classes.get(best), p[best], remaining, probs);
    }

    /** weights for storing: enough to restore the model */
    Map<String, Object> state() {
        return Map.of("mean", mean, "std", std, "w", w, "rul", rul);
    }
}
