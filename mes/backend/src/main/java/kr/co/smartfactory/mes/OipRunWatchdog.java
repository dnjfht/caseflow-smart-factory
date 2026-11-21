package kr.co.smartfactory.mes;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/** A hidden editor can report running while its visual simulation has stopped advancing. */
@Component
@ConditionalOnProperty(name="mes.plc.mode",havingValue="opcua",matchIfMissing=true)
public class OipRunWatchdog {
    private static final Logger log=LoggerFactory.getLogger(OipRunWatchdog.class);
    private final OipRunGateway oip;
    private double lastSimTime=Double.NaN;
    private long lastProgress=System.nanoTime();

    public OipRunWatchdog(OipRunGateway oip) { this.oip=oip; }

    @Scheduled(fixedDelay=5000,initialDelay=15000)
    public void check() {
        try {
            JsonNode context=oip.state("get_context");
            if (!context.path("running").asBoolean() || context.path("paused").asBoolean()) {
                lastSimTime=Double.NaN;
                lastProgress=System.nanoTime();
                return;
            }
            double time=oip.state("get_cargo").path("simTime").asDouble(Double.NaN);
            if (!Double.isFinite(time)) return;
            if (!Double.isFinite(lastSimTime) || time>lastSimTime+.01) {
                lastSimTime=time;
                lastProgress=System.nanoTime();
            } else if (System.nanoTime()-lastProgress>12_000_000_000L) {
                oip.state("pause");
                oip.state("resume");
                lastProgress=System.nanoTime();
                log.warn("OIP 현장 시간 정체 감지: {}초에서 재개",time);
            }
        } catch (Exception unavailable) {
            lastSimTime=Double.NaN;
            lastProgress=System.nanoTime();
        }
    }
}
