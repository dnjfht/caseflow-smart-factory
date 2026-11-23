package kr.co.smartfactory.mes;

import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Quality by calendar period (day, week, month, year): good and rejected cases from the production LOTs, counted on
 * the day the LOT was started, and the vision AI's defect causes, counted on the day of each inspection. Periods are
 * Korean calendar days (Asia/Seoul); weeks start on Monday. Empty periods are kept so the axis reads as time.
 */
@RestController
@RequestMapping("/api/quality")
public class QualityController {
    static final ZoneId ZONE = ZoneId.of("Asia/Seoul");
    private final JdbcTemplate db;

    public QualityController(JdbcTemplate db) { this.db = db; }

    @GetMapping("/trend")
    public Map<String, Object> trend(@RequestParam(defaultValue = "day") String period,
                                     @RequestParam(required = false) Integer count) {
        int n = switch (period) {
            case "day" -> 14; case "week" -> 12; case "month" -> 12; case "year" -> 5;
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "period는 day, week, month, year 중 하나입니다.");
        };
        if (count != null) n = Math.max(1, Math.min(60, count));
        LocalDate today = LocalDate.now(ZONE);
        List<LocalDate> starts = new ArrayList<>();
        LocalDate cur = start(today, period);
        for (int i = 0; i < n; i++) { starts.add(0, cur); cur = previous(cur, period); }
        LocalDate first = starts.get(0);
        List<Map<String, Object>> buckets = new ArrayList<>();
        for (LocalDate s : starts) {
            Map<String, Object> b = new LinkedHashMap<>();
            b.put("start", s.toString());
            b.put("label", label(s, period));
            b.put("good", 0);
            b.put("bad", 0);
            b.put("inspected", 0);
            b.put("byCause", new LinkedHashMap<String, Integer>());
            buckets.add(b);
        }
        Timestamp from = Timestamp.from(first.atStartOfDay(ZONE).toInstant());
        for (Map<String, Object> r : db.queryForList(
            "SELECT created_at, good_qty, rejected_qty FROM production_lot WHERE created_at >= ?", from)) {
            Map<String, Object> b = bucket(buckets, starts, day(r.get("created_at")), period);
            if (b == null) continue;
            b.put("good", (int) b.get("good") + ((Number) r.get("good_qty")).intValue());
            b.put("bad", (int) b.get("bad") + ((Number) r.get("rejected_qty")).intValue());
        }
        for (Map<String, Object> r : db.queryForList(
            "SELECT inspected_at, verdict_good, cause FROM ai_inspection WHERE inspected_at >= ?", from)) {
            Map<String, Object> b = bucket(buckets, starts, day(r.get("inspected_at")), period);
            if (b == null) continue;
            b.put("inspected", (int) b.get("inspected") + 1);
            if (!Boolean.TRUE.equals(r.get("verdict_good"))) {
                @SuppressWarnings("unchecked") Map<String, Integer> c = (Map<String, Integer>) b.get("byCause");
                c.merge(String.valueOf(r.get("cause")), 1, Integer::sum);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("period", period);
        out.put("buckets", buckets);
        return out;
    }

    private static LocalDate day(Object ts) {
        if (ts instanceof Timestamp t) return t.toInstant().atZone(ZONE).toLocalDate();
        if (ts instanceof java.time.OffsetDateTime o) return o.atZoneSameInstant(ZONE).toLocalDate();
        if (ts instanceof java.time.LocalDateTime l) return l.atZone(ZoneId.systemDefault()).withZoneSameInstant(ZONE).toLocalDate();
        return LocalDate.parse(String.valueOf(ts).substring(0, 10));
    }

    static LocalDate start(LocalDate d, String period) {
        return switch (period) {
            case "week" -> d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            case "month" -> d.withDayOfMonth(1);
            case "year" -> d.withDayOfYear(1);
            default -> d;
        };
    }

    private static LocalDate previous(LocalDate s, String period) {
        return switch (period) {
            case "week" -> s.minusWeeks(1);
            case "month" -> s.minusMonths(1);
            case "year" -> s.minusYears(1);
            default -> s.minusDays(1);
        };
    }

    private static Map<String, Object> bucket(List<Map<String, Object>> buckets, List<LocalDate> starts, LocalDate d, String period) {
        int i = starts.indexOf(start(d, period));
        return i < 0 ? null : buckets.get(i);
    }

    static String label(LocalDate s, String period) {
        return switch (period) {
            case "week" -> s.format(DateTimeFormatter.ofPattern("M/d")) + "주";
            case "month" -> s.getYear() % 100 + "." + s.getMonthValue();
            case "year" -> String.valueOf(s.getYear());
            default -> s.format(DateTimeFormatter.ofPattern("M/d"));
        };
    }
}
