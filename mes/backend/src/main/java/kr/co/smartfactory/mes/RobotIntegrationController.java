package kr.co.smartfactory.mes;

import jakarta.annotation.PostConstruct;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Demo bridge configuration. Robot motion is executed only by the ROS 2 bridge on a PLC request. */
@RestController
@RequestMapping("/api/robot")
public class RobotIntegrationController {
    private final JdbcTemplate db;

    public RobotIntegrationController(JdbcTemplate db) { this.db=db; }

    @PostConstruct
    public void seed() {
        if (db.queryForObject("SELECT COUNT(*) FROM robot_config WHERE id=1",Integer.class)==0)
            db.update("INSERT INTO robot_config(id,recipe,speed_pct,enabled) VALUES (1,'ASSEMBLY_DEMO',100,FALSE)");
        if (db.queryForObject("SELECT COUNT(*) FROM robot_bridge_status WHERE id=1",Integer.class)==0)
            db.update("INSERT INTO robot_bridge_status(id,state,detail,completed_cycles,plc_connected,action_available) " +
                "VALUES (1,'OFFLINE','브리지 실행 전',0,FALSE,FALSE)");
    }

    @GetMapping("/status")
    public Map<String,Object> status() {
        Map<String,Object> result=new LinkedHashMap<>(db.queryForMap("SELECT recipe,speed_pct,enabled,preview_requested,updated_at FROM robot_config WHERE id=1"));
        Map<String,Object> bridge=db.queryForMap("SELECT state,detail,completed_cycles,plc_connected,action_available,updated_at AS bridge_updated_at FROM robot_bridge_status WHERE id=1");
        result.putAll(bridge);
        Timestamp updated=(Timestamp)bridge.get("BRIDGE_UPDATED_AT");
        boolean fresh=updated!=null && !"OFFLINE".equals(bridge.get("STATE")) &&
            Duration.between(updated.toInstant(),Instant.now()).abs().getSeconds()<12;
        result.put("BRIDGE_ALIVE",fresh);
        if (!fresh) result.put("STATE","OFFLINE");
        return result;
    }

    public record ConfigRequest(String recipe,int speedPct,boolean enabled) {}
    @PostMapping("/config")
    @Transactional
    public Map<String,Object> config(@RequestBody ConfigRequest request) {
        if (!"ASSEMBLY_DEMO".equals(request.recipe()) || request.speedPct()<50 || request.speedPct()>100)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"승인된 데모 동작과 속도 50~100%를 선택하세요.");
        Integer active=db.queryForObject("SELECT COUNT(*) FROM mes_order WHERE status IN ('RUNNING','PAUSED')",Integer.class);
        if (active!=null && active>0)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"작업 중에는 로봇 연동 설정을 변경할 수 없습니다.");
        db.update("UPDATE robot_config SET recipe=?,speed_pct=?,enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=1",
            request.recipe(),request.speedPct(),request.enabled());
        return status();
    }

    public record TelemetryRequest(String state,String detail,int completedCycles,boolean plcConnected,boolean actionAvailable) {}
    @PostMapping("/telemetry")
    public Map<String,Object> telemetry(@RequestBody TelemetryRequest request) {
        if (request.state()==null || !request.state().matches("[A-Z_]{1,40}") ||
            request.detail()==null || request.detail().length()>200 || request.completedCycles()<0)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"로봇 상태 형식이 올바르지 않습니다.");
        db.update("UPDATE robot_bridge_status SET state=?,detail=?,completed_cycles=?,plc_connected=?," +
            "action_available=?,updated_at=CURRENT_TIMESTAMP WHERE id=1",request.state(),request.detail(),
            request.completedCycles(),request.plcConnected(),request.actionAvailable());
        return status();
    }
}
