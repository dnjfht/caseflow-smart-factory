package kr.co.smartfactory.mes;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * The line as the MES sees it on the server: up to two copies of the same virtual line, kept in step.
 * <ul>
 *   <li><b>Field</b>: OIP Desktop on the shop-floor PC, reached through the field agent
 *       ({@code field-agent/caseflow-field-agent.mjs}) posting to {@code /api/field/sync}. When it is connected it is
 *       the line of record: the MES counts its production.</li>
 *   <li><b>Web twin</b>: the same scene and program running in the browser that has the MES open
 *       ({@code /api/twin/sync}). One browser drives at a time (a lease); the others watch. Without a field PC it is
 *       the line of record.</li>
 * </ul>
 * Both copies get the MES's writes (permit, target, material permit and stock). A start or stop on either copy (its
 * run latch rising or falling) is pressed on the other as a pulse, so starting the line in the browser starts OIP
 * Desktop and the other way round. A new work order resets both; a robot program applied on the pendant goes to both.
 */
@Component
@ConditionalOnProperty(name = "mes.plc.mode", havingValue = "twin")
public class TwinGateway implements PlcGateway {
    static final Duration LEASE = Duration.ofSeconds(8);
    static final Duration STALE = Duration.ofSeconds(5);

    /** one copy of the line: its last tags, when they came, and the presses queued for it */
    static final class Side {
        volatile Map<String, Object> tags = Map.of();
        volatile Instant seen = Instant.EPOCH;
        volatile Boolean runLatch;
        final List<String> pulses = new ArrayList<>();
        boolean fresh(Instant now) { return Duration.between(seen, now).compareTo(STALE) <= 0; }
    }

    private final Side twin = new Side();
    private final Side field = new Side();
    private volatile String holder;
    private volatile Instant holderSeen = Instant.EPOCH;
    private final Map<String, Object> desired = new ConcurrentHashMap<>(Map.of("MesPermit", false, "WorkOrderActive", 1));
    private final AtomicInteger resetSeq = new AtomicInteger();
    private final AtomicInteger programSeq = new AtomicInteger();

    public record SyncReply(boolean lease, Map<String, Object> writes, List<String> pulses, int resetSeq, int programSeq,
        boolean fieldConnected, Map<String, Object> tags) { }

    /** a browser's twin reports; the lease holder's twin is a live copy of the line */
    public synchronized SyncReply syncTwin(String session, Map<String, Object> reported) {
        Instant now = Instant.now();
        if (holder == null || Duration.between(holderSeen, now).compareTo(LEASE) > 0) holder = session;
        boolean lease = session != null && session.equals(holder);
        if (!lease) return new SyncReply(false, Map.of(), List.of(), resetSeq.get(), programSeq.get(), field.fresh(now), lineTags(now));
        holderSeen = now;
        accept(twin, field, reported, now);
        return new SyncReply(true, new LinkedHashMap<>(desired), drain(twin), resetSeq.get(), programSeq.get(), field.fresh(now), Map.of());
    }

    /** the shop-floor PC's agent reports OIP Desktop's tags */
    public synchronized SyncReply syncField(Map<String, Object> reported) {
        Instant now = Instant.now();
        accept(field, twin, reported, now);
        return new SyncReply(true, new LinkedHashMap<>(desired), drain(field), resetSeq.get(), programSeq.get(), true, Map.of());
    }

    private void accept(Side self, Side other, Map<String, Object> reported, Instant now) {
        if (reported == null || reported.isEmpty()) return;
        self.tags = Map.copyOf(reported);
        self.seen = now;
        Object latch = reported.get("RunLatch");
        if (latch instanceof Boolean on) {
            // an edge on this copy is a button press on the other copy; the first report sets the baseline
            if (self.runLatch != null && !self.runLatch.equals(on) && other.fresh(now)) {
                Object otherLatch = other.tags.get("RunLatch");
                if (!on.equals(otherLatch)) other.pulses.add(on ? "HmiStart" : "HmiStop");
            }
            self.runLatch = on;
        }
    }

    private List<String> drain(Side side) {
        List<String> out = List.copyOf(side.pulses);
        side.pulses.clear();
        return out;
    }

    /** the line of record: OIP Desktop when the field PC is connected, else the driving browser's twin */
    private Map<String, Object> lineTags(Instant now) {
        return field.fresh(now) ? field.tags : twin.fresh(now) ? twin.tags : Map.of();
    }

    public boolean fieldConnected() { return field.fresh(Instant.now()); }
    public void programChanged() { programSeq.incrementAndGet(); }

    @Override
    public PlcSnapshot sample() {
        Instant now = Instant.now();
        boolean fieldLine = field.fresh(now);
        Side line = fieldLine ? field : twin.fresh(now) ? twin : null;
        if (line == null) return PlcSnapshot.offline("현장 연결 대기: MES 화면(웹 트윈) 또는 현장 PC(OIP)가 연결되면 가동됩니다");
        Map<String, Object> t = line.tags;
        return new PlcSnapshot(true, fieldLine ? "현장 PC OIP 연결 (웹 트윈 동기)" : "웹 트윈 PLC 연결", line.seen,
            num(t, "TargetQuantity"), num(t, "LaunchedCount"), num(t, "RejectCount"), num(t, "ProducedCount"), num(t, "ShippedCount"),
            num(t, "MachineState"), num(t, "AssemblyPhase"), num(t, "InspectionPhase"), num(t, "PackingPhase"),
            !bool(t, "MesPermit"), bool(t, "BodyConveyorRun"), bool(t, "BodyStopper"), bool(t, "LidStopper"), bool(t, "RejectDiverter"));
    }

    private static int num(Map<String, Object> t, String k) { return t.get(k) instanceof Number n ? n.intValue() : 0; }
    private static boolean bool(Map<String, Object> t, String k) { return Boolean.TRUE.equals(t.get(k)); }

    @Override public void stop(boolean stopped) { desired.put("MesPermit", !stopped); }
    @Override public void target(int quantity) { desired.put("TargetQuantity", quantity); }
    @Override public void materialPermit(boolean permitted) { desired.put("MesMaterialPermit", permitted); }
    @Override public void materialStock(int bodies, int lids) {
        desired.put("BodyStockDisplay", Math.min(bodies, Short.MAX_VALUE));
        desired.put("LidStockDisplay", Math.min(lids, Short.MAX_VALUE));
    }
    /** both copies stop and restart their simulation when they see the counter move: counters and cargo clear */
    @Override public synchronized void resetLine() {
        resetSeq.incrementAndGet();
        twin.seen = Instant.EPOCH;
        field.seen = Instant.EPOCH;
        twin.runLatch = null;
        field.runLatch = null;
    }
    @Override public long resetTimeoutMs() { return 25000; }
    @Override public void close() { }
}
