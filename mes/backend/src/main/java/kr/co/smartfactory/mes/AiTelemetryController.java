package kr.co.smartfactory.mes;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai")
@ConditionalOnProperty(name="mes.poll.enabled",havingValue="true",matchIfMissing=true)
public class AiTelemetryController {
    private final JdbcTemplate db;
    private final MesService mes;

    public AiTelemetryController(JdbcTemplate db, MesService mes) {
        this.db = db;
        this.mes = mes;
    }

    // Keep the source measurements distinct from any future model output.
    @Scheduled(fixedDelay=5000, initialDelay=5000)
    public void capture() {
        PlcSnapshot p = mes.plc();
        Long orderId = db.query("SELECT id FROM mes_order WHERE status IN ('RUNNING','PAUSED') ORDER BY id DESC LIMIT 1",
            rs -> rs.next() ? rs.getLong(1) : null);
        db.update("INSERT INTO plc_telemetry(sampled_at,order_id,connected,target_qty,launched_count,reject_count," +
            "packed_count,exit_count,machine_state,assembly_phase,inspection_phase,packing_phase,mes_stop,motor_running) " +
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            Timestamp.from(p.sampledAt()),orderId,p.connected(),p.target(),p.launched(),p.rejected(),p.packed(),
            p.lineExit(),p.machineState(),p.assemblyPhase(),p.inspectionPhase(),p.packingPhase(),p.mesStop(),p.motorRunning());
    }

    @GetMapping("/status")
    public Map<String,Object> status() {
        Map<String,Object> measurements = db.queryForMap(
            "SELECT COUNT(*) AS samples, MAX(sampled_at) AS last_sample FROM plc_telemetry");
        return Map.of("modelState","NOT_TRAINED", "sampleCount", measurements.get("SAMPLES"),
            "lastSample", String.valueOf(measurements.get("LAST_SAMPLE")),
            "qualityLabels","OIP_SIMULATED", "maintenanceLabels","NOT_COLLECTED",
            "sensorInputs","PLC_PHASE_AND_COUNTERS_ONLY");
    }

    @GetMapping("/telemetry")
    public List<Map<String,Object>> telemetry(@RequestParam(defaultValue="60") int limit) {
        int safeLimit = Math.max(1, Math.min(500, limit));
        return db.queryForList("SELECT * FROM plc_telemetry ORDER BY id DESC LIMIT ?",safeLimit);
    }
}
