package kr.co.smartfactory.mes;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * The web twin as the MES's PLC. The twin (the line running in a browser, /app/?scene=caseflow) posts its tags
 * every half second to {@code /api/twin/sync}; the reply carries what the MES wants written (permit, target,
 * material permit and stock) and a reset counter. One browser at a time drives the line: it holds a lease that
 * lapses after a few seconds without a sync, and every other open MES watches.
 */
@Component
@ConditionalOnProperty(name = "mes.plc.mode", havingValue = "twin")
public class TwinGateway implements PlcGateway {
    static final Duration LEASE = Duration.ofSeconds(8);
    static final Duration STALE = Duration.ofSeconds(5);

    private volatile Map<String, Object> tags = Map.of();
    private volatile Instant seen = Instant.EPOCH;
    private volatile String holder;
    private volatile Instant holderSeen = Instant.EPOCH;
    private final Map<String, Object> desired = new ConcurrentHashMap<>(Map.of(
        "MesPermit", false, "WorkOrderActive", 1));
    private final AtomicInteger resetSeq = new AtomicInteger();

    public record SyncReply(boolean lease, Map<String, Object> writes, int resetSeq, Map<String, Object> tags) { }

    /** a twin reports its tags; the lease holder's tags become the line's state */
    public synchronized SyncReply sync(String session, Map<String, Object> reported) {
        Instant now = Instant.now();
        boolean free = holder == null || Duration.between(holderSeen, now).compareTo(LEASE) > 0;
        if (free) holder = session;
        boolean lease = session != null && session.equals(holder);
        if (lease) {
            holderSeen = now;
            if (reported != null && !reported.isEmpty()) {
                tags = Map.copyOf(reported);
                seen = now;
            }
        }
        return new SyncReply(lease, new LinkedHashMap<>(desired), resetSeq.get(), lease ? Map.of() : tags);
    }

    private int num(String k) {
        Object v = tags.get(k);
        return v instanceof Number n ? n.intValue() : 0;
    }

    private boolean bool(String k) { return Boolean.TRUE.equals(tags.get(k)); }

    @Override
    public PlcSnapshot sample() {
        if (Duration.between(seen, Instant.now()).compareTo(STALE) > 0)
            return PlcSnapshot.offline("웹 트윈 연결 대기: MES 화면을 열면 가상 공정이 연결됩니다");
        return new PlcSnapshot(true, "웹 트윈 PLC 연결", seen,
            num("TargetQuantity"), num("LaunchedCount"), num("RejectCount"), num("ProducedCount"), num("ShippedCount"),
            num("MachineState"), num("AssemblyPhase"), num("InspectionPhase"), num("PackingPhase"),
            !bool("MesPermit"), bool("BodyConveyorRun"), bool("BodyStopper"), bool("LidStopper"), bool("RejectDiverter"));
    }

    @Override public void stop(boolean stopped) { desired.put("MesPermit", !stopped); }
    @Override public void target(int quantity) { desired.put("TargetQuantity", quantity); }
    @Override public void materialPermit(boolean permitted) { desired.put("MesMaterialPermit", permitted); }
    @Override public void materialStock(int bodies, int lids) {
        desired.put("BodyStockDisplay", Math.min(bodies, Short.MAX_VALUE));
        desired.put("LidStockDisplay", Math.min(lids, Short.MAX_VALUE));
    }
    /** the twin stops and restarts its simulation when it sees the counter move: counters and cargo clear */
    @Override public void resetLine() { resetSeq.incrementAndGet(); seen = Instant.EPOCH; }
    @Override public long resetTimeoutMs() { return 20000; }
    @Override public void close() { }
}
