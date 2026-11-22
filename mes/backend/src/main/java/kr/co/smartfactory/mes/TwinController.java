package kr.co.smartfactory.mes;

import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** The web twin's link to the MES: tag sync, and the robot program taught on the pendant (kept in the DB). */
@RestController
@RequestMapping("/api/twin")
@ConditionalOnProperty(name = "mes.plc.mode", havingValue = "twin")
public class TwinController {
    private final TwinGateway twin;
    private final JdbcTemplate db;
    private final ObjectMapper json;

    public TwinController(TwinGateway twin, JdbcTemplate db, ObjectMapper json) { this.twin = twin; this.db = db; this.json = json; }

    public record SyncRequest(String session, Map<String, Object> tags) { }

    @PostMapping("/sync")
    public TwinGateway.SyncReply sync(@RequestBody SyncRequest request) {
        return twin.syncTwin(request.session(), request.tags());
    }

    public record PressRequest(String key) { }

    /** the operator panel's start/stop, pressed on the line (OIP Desktop when the field PC is connected) */
    @PostMapping("/press")
    public Map<String, Object> press(@RequestBody PressRequest request) {
        try { twin.press(request.key()); }
        catch (IllegalArgumentException e) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "HmiStart 또는 HmiStop만 누를 수 있습니다."); }
        return Map.of("pressed", request.key(), "fieldConnected", twin.fieldConnected());
    }

    /** both copies of the line side by side, with their verdict sequences: is the twin following product for product? */
    @GetMapping("/status")
    public Map<String, Object> status() { return twin.status(); }

    /** the shop-floor PC's agent: OIP Desktop's tags in, the MES's writes and the operator panel's presses out */
    @PostMapping("/field-sync")
    public TwinGateway.SyncReply fieldSync(@RequestBody SyncRequest request) {
        return twin.syncField(request.tags());
    }

    /** {@code model} is the robot package the poses were taught on (neuromeka.indy7): joint angles mean nothing on another arm */
    public record RobotProgram(List<List<Double>> waypoints, List<String> names, List<List<Double>> steps, String savedBy, String model) { }

    @GetMapping("/robot-program")
    public Map<String, Object> robotProgram() {
        List<Map<String, Object>> rows = db.queryForList("SELECT program_json, saved_by, saved_at FROM twin_robot_program ORDER BY id DESC LIMIT 1");
        if (rows.isEmpty()) return Map.of();
        Map<String, Object> row = rows.getFirst();
        return Map.of("program", json.readTree(String.valueOf(row.get("PROGRAM_JSON") != null ? row.get("PROGRAM_JSON") : row.get("program_json"))),
            "savedBy", String.valueOf(row.getOrDefault("SAVED_BY", row.getOrDefault("saved_by", ""))),
            "savedAt", String.valueOf(row.getOrDefault("SAVED_AT", row.getOrDefault("saved_at", ""))));
    }

    @PostMapping("/robot-program")
    public Map<String, Object> saveRobotProgram(@RequestBody RobotProgram program) {
        if (program.waypoints() == null || program.steps() == null || program.steps().isEmpty())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "웨이포인트와 작업 순서가 필요합니다.");
        if (twin.sample().connected() && twin.sample().machineState() == 2)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "공정 가동 중에는 로봇 프로그램을 바꿀 수 없습니다.");
        db.update("INSERT INTO twin_robot_program (program_json, saved_by) VALUES (?, ?)",
            json.writeValueAsString(program), program.savedBy() == null ? "" : program.savedBy());
        twin.programChanged();
        return Map.of("saved", true);
    }
}
