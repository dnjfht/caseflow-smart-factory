package kr.co.smartfactory.mes;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 설비 관리: everyone may look; the changes (repair, confirm, preventive service) are the 설비 관리자's (AuthInterceptor) */
@RestController
@RequestMapping("/api/equipment")
public class EquipmentController {
    private final EquipmentService equipment;
    private final JdbcTemplate db;

    public EquipmentController(EquipmentService equipment, JdbcTemplate db) { this.equipment = equipment; this.db = db; }

    @GetMapping public Map<String, Object> overview() { return equipment.overview(); }

    @GetMapping("/{asset}/readings")
    public List<Map<String, Object>> readings(@PathVariable String asset, @RequestParam(defaultValue = "60") int limit) {
        return equipment.readings(asset, limit);
    }

    /** the maintenance record, newest first, one page at a time */
    @GetMapping("/faults")
    public Map<String, Object> faults(@RequestParam(defaultValue = "10") int limit, @RequestParam(defaultValue = "0") int offset) {
        int n = Math.max(1, Math.min(100, limit));
        return Map.of("total", db.queryForObject("SELECT COUNT(*) FROM equipment_fault", Integer.class),
            "rows", db.queryForList("SELECT * FROM equipment_fault ORDER BY id DESC LIMIT ? OFFSET ?", n, Math.max(0, offset)));
    }

    /** failures by cause and by equipment, with downtime and how often the model warned first */
    @GetMapping("/stats")
    public Map<String, Object> stats() {
        return Map.of(
            "byMode", db.queryForList("SELECT mode_code, COUNT(*) AS n, SUM(CASE WHEN alarm_lead_units IS NOT NULL THEN 1 ELSE 0 END) AS predicted " +
                "FROM equipment_fault WHERE kind='BREAKDOWN' GROUP BY mode_code"),
            "byAsset", db.queryForList("SELECT asset_code, kind, COUNT(*) AS n FROM equipment_fault GROUP BY asset_code, kind"),
            "downtime", db.queryForList("SELECT id, asset_code, kind, locked_at, confirmed_at FROM equipment_fault WHERE confirmed_at IS NOT NULL ORDER BY id DESC LIMIT 200"),
            "alarms", db.queryForList("SELECT * FROM pdm_alarm ORDER BY id DESC LIMIT 20"));
    }

    @PostMapping("/faults/{id}/repair")
    public Map<String, Object> repair(@PathVariable long id, HttpServletRequest req) { return equipment.startRepair(id, who(req)); }

    @PostMapping("/faults/{id}/confirm")
    public Map<String, Object> confirm(@PathVariable long id, HttpServletRequest req) { return equipment.confirm(id, who(req)); }

    @PostMapping("/{asset}/preventive")
    public Map<String, Object> preventive(@PathVariable String asset, HttpServletRequest req) { return equipment.preventive(asset, who(req)); }

    @PostMapping("/retrain")
    public Map<String, Object> retrain() { equipment.retrain("설비 관리자 요청"); return equipment.overview(); }

    public record Speed(double speed) {}

    /** 시연 배율: how many cases of wear one launched case counts for (시스템 관리자) */
    @PostMapping("/speed")
    public Map<String, Object> speed(@RequestBody Speed s) { equipment.setSpeed(s.speed()); return equipment.overview(); }

    private static String who(HttpServletRequest req) {
        AuthService.User u = AuthController.current(req);
        return u == null ? "알 수 없음" : u.label();
    }
}
