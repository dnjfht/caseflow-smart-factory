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
 * The line as the MES sees it on the server. One copy of the virtual line is the line; the other, when there is one,
 * follows it.
 * <ul>
 *   <li><b>Field</b>: OIP Desktop on the shop-floor PC, reached through the field agent
 *       ({@code field-agent/caseflow-field-agent.mjs}, {@code /api/twin/field-sync}). When it is connected it IS the
 *       line: its PLC runs the process and the MES counts its production.</li>
 *   <li><b>Web twin</b>: the same scene running in the browser that has the MES open ({@code /api/twin/sync}). With a
 *       field PC it follows OIP Desktop (mirror mode): it runs its own PLC program, so its robot, cells and stoppers
 *       keep their own correct timing, but it launches a set only when the desktop has launched one, takes the
 *       desktop's verdict for each product in order instead of judging it, and runs and stops with the desktop. Its
 *       own counts are never recorded. Without a field PC it is the line itself. One browser drives at a time.</li>
 * </ul>
 * A start or stop pressed anywhere (the MES operator panel, OIP Desktop's buttons) acts on the one line, so the two
 * screens never run two separate productions.
 */
@Component
@ConditionalOnProperty(name = "mes.plc.mode", havingValue = "twin")
public class TwinGateway implements PlcGateway {
    static final Duration LEASE = Duration.ofSeconds(8);
    /** a copy silent this long is gone (the free server or the field PC's network can pause a few seconds) */
    static final Duration STALE = Duration.ofSeconds(10);
    /** the field PC back after this long is a new start: the twin clears its line and follows from there */
    static final Duration REJOIN = Duration.ofSeconds(30);

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
    private final Map<String, Object> desired = new ConcurrentHashMap<>(Map.of("MesPermit", false, "WorkOrderActive", 1, "MirrorMode", false));
    private final AtomicInteger resetSeq = new AtomicInteger();
    private final AtomicInteger programSeq = new AtomicInteger();

    /** the counters the MES reconciles; kept continuous when the line of record changes copy mid-order */
    static final String[] COUNTERS = {"LaunchedCount", "RejectCount", "ProducedCount", "ShippedCount"};
    private Side recordSide;
    private final int[] lastCount = new int[COUNTERS.length];
    private final int[] offset = new int[COUNTERS.length];
    private final int[] lastRaw = new int[COUNTERS.length];

    private final AtomicInteger mirrorSeq = new AtomicInteger();
    /** OIP Desktop's verdicts in order (true = good): the mirroring twin's n-th product gets the desktop's n-th verdict */
    private final List<Boolean> fieldVerdicts = new ArrayList<>();
    /**
     * How many sets OIP Desktop had launched when the twin started following it: the twin's n-th set is the desktop's
     * (launchBase + n)-th, and so is its n-th verdict (products are inspected in the order they were launched)
     */
    private int launchBase;
    private Instant lastMirrorPress = Instant.EPOCH;
    /** after a new work order, until OIP Desktop reports its line cleared: its old counts must not reach the twin */
    private boolean awaitingFieldReset;

    /**
     * {@code mirror}: the outputs to force on a twin that follows OIP Desktop, else null. {@code mirrorSeq} moves when
     * the twin should clear its line before it starts following (the field PC came online). {@code tags}: the line's
     * tags, for the operator panel.
     */
    public record SyncReply(boolean lease, Map<String, Object> writes, List<String> pulses, int resetSeq, int programSeq,
        boolean fieldConnected, Map<String, Object> tags, Map<String, Object> mirror, int mirrorSeq) {
        SyncReply(boolean lease, Map<String, Object> writes, List<String> pulses, int resetSeq, int programSeq,
            boolean fieldConnected, Map<String, Object> tags) {
            this(lease, writes, pulses, resetSeq, programSeq, fieldConnected, tags, null, 0);
        }
    }

    /** a browser's twin reports; the lease holder's twin is a live copy of the line */
    public synchronized SyncReply syncTwin(String session, Map<String, Object> reported) {
        Instant now = Instant.now();
        if (holder == null || Duration.between(holderSeen, now).compareTo(LEASE) > 0) {
            if (holder != null && !holder.equals(session)) twin.runLatch = null; // a different browser (or a reload) now drives
            holder = session;
        }
        boolean lease = session != null && session.equals(holder);
        if (!lease) return new SyncReply(false, Map.of(), List.of(), resetSeq.get(), programSeq.get(), field.fresh(now), lineTags(now));
        holderSeen = now;
        // a twin that counts lower than it did has started over (a reload, a new browser): it follows from here
        boolean twinRestarted = reported != null && num(reported, "LaunchedCount") < num(twin.tags, "LaunchedCount");
        accept(twin, reported, now);
        if (field.fresh(now)) {
            // the twin follows OIP Desktop: it runs its own PLC program (so its robot, cells and stoppers keep their own
            // timing), launches a set only when the desktop has, and takes the desktop's verdict for each product
            if (twinRestarted) rebaseMirror();
            Map<String, Object> f = field.tags, w = new LinkedHashMap<>(desired);
            // the twin never finishes by its own count: it runs while the desktop does, then until it has handled every
            // set the desktop launched (its products are the desktop's, one for one, in launch order)
            int twinTarget = 30000; // far below INT max: the PLC adds the reject count to it
            w.put("MirrorMode", true);
            // the twin trails the desktop: when the desktop finishes and the MES withdraws the permit, the twin keeps it
            // until it has shipped what the desktop shipped, so it finishes its own last products instead of stopping short
            int twinLaunched = num(twin.tags, "LaunchedCount");
            boolean catchingUp = twinLaunched < num(f, "LaunchedCount") - launchBase
                || num(twin.tags, "RejectCount") + num(twin.tags, "ShippedCount") < twinLaunched;
            w.put("MesPermit", bool(f, "MesPermit") || (catchingUp && bool(twin.tags, "RunLatch")));
            w.put("MesMaterialPermit", !Boolean.FALSE.equals(f.get("MesMaterialPermit")));
            w.put("TargetQuantity", twinTarget);
            w.put("MirrorLaunchLimit", awaitingFieldReset ? 0 : Math.max(0, num(f, "LaunchedCount") - launchBase));
            int index = launchBase + num(twin.tags, "InspectedCount");
            boolean ready = index < fieldVerdicts.size();
            w.put("MirrorVerdictReady", ready);
            w.put("MirrorVerdictGood", ready && fieldVerdicts.get(index));
            // run and stop with the desktop (a stop for reaching the target is the twin's own, after its last product)
            boolean fieldRun = bool(f, "RunLatch"), twinRun = bool(twin.tags, "RunLatch");
            boolean fieldFinished = num(f, "TargetQuantity") > 0 && num(f, "ShippedCount") >= num(f, "TargetQuantity");
            List<String> press = new ArrayList<>();
            if (Duration.between(lastMirrorPress, now).toMillis() > 1500) {
                if (fieldRun && !twinRun) press.add("HmiStart");
                else if (!fieldRun && twinRun && !fieldFinished) press.add("HmiStop");
                if (!press.isEmpty()) lastMirrorPress = now;
            }
            twin.pulses.clear();
            return new SyncReply(true, w, press, resetSeq.get(), programSeq.get(), true, field.tags, Map.of(), mirrorSeq.get());
        }
        return new SyncReply(true, writesFor(twin), drain(twin), resetSeq.get(), programSeq.get(), false, twin.tags, null, mirrorSeq.get());
    }

    /** the shop-floor PC's agent reports OIP Desktop's tags */
    public synchronized SyncReply syncField(Map<String, Object> reported) {
        Instant now = Instant.now();
        boolean comingOnline = Duration.between(field.seen, now).compareTo(REJOIN) > 0;
        if (reported != null && num(reported, "InspectedCount") < num(field.tags, "InspectedCount")) fieldVerdicts.clear(); // desktop restarted
        accept(field, reported, now);
        if (awaitingFieldReset && num(field.tags, "LaunchedCount") == 0 && num(field.tags, "InspectedCount") == 0) awaitingFieldReset = false;
        if (!awaitingFieldReset) recordVerdicts();
        if (comingOnline) { mirrorSeq.incrementAndGet(); rebaseMirror(); } // the twin clears its line and follows from here
        return new SyncReply(true, writesFor(field), drain(field), resetSeq.get(), programSeq.get(), true, Map.of());
    }

    private void accept(Side self, Map<String, Object> reported, Instant now) {
        if (reported == null || reported.isEmpty()) return;
        self.tags = Map.copyOf(reported);
        self.seen = now;
        if (reported.get("RunLatch") instanceof Boolean on) self.runLatch = on;
    }

    /** the desktop's n-th verdict is its LastVerdictGood when its InspectedCount reaches n+1 */
    private void recordVerdicts() {
        int n = num(field.tags, "InspectedCount");
        while (fieldVerdicts.size() < n) fieldVerdicts.add(bool(field.tags, "LastVerdictGood"));
    }

    private void rebaseMirror() {
        launchBase = num(field.tags, "LaunchedCount");
    }

    /** a start or stop pressed on the MES operator panel acts on the line: OIP Desktop if connected, else the twin */
    public synchronized void press(String key) {
        if (!"HmiStart".equals(key) && !"HmiStop".equals(key)) throw new IllegalArgumentException(key);
        (field.fresh(Instant.now()) ? field : twin).pulses.add(key);
    }

    /**
     * The MES writes for the line. Its target is what it has shipped itself plus what the order still needs, so a copy
     * that takes over mid-order (the field PC came online or dropped out, a page was reloaded) makes exactly the rest.
     */
    private Map<String, Object> writesFor(Side side) {
        Map<String, Object> w = new LinkedHashMap<>(desired);
        if (desired.get("TargetQuantity") instanceof Number t && recordSide != null) {
            int remaining = Math.max(0, t.intValue() - lastCount[3]);
            w.put("TargetQuantity", num(side.tags, "ShippedCount") + remaining);
        }
        return w;
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
    public synchronized PlcSnapshot sample() {
        Instant now = Instant.now();
        boolean fieldLine = field.fresh(now);
        Side line = fieldLine ? field : twin.fresh(now) ? twin : null;
        if (line == null) return PlcSnapshot.offline("현장 연결 대기: MES 화면(웹 트윈) 또는 현장 PC(OIP)가 연결되면 가동됩니다");
        Map<String, Object> t = line.tags;
        int[] c = new int[COUNTERS.length];
        // the same copy counting from lower than before restarted (a reloaded page): re-baseline as on a switch
        boolean restarted = line == recordSide && (num(t, "LaunchedCount") < lastRaw[0] || num(t, "ShippedCount") < lastRaw[3]);
        if (restarted) for (int i = 0; i < c.length; i++) offset[i] = lastCount[i] - num(t, COUNTERS[i]);
        if (line != recordSide) {
            // the other copy took over (field PC connected or dropped): carry on from the counts already reported,
            // so the switch reads as neither lost nor repeated production
            if (recordSide != null) {
                for (int i = 0; i < c.length; i++) offset[i] = lastCount[i] - num(t, COUNTERS[i]);
                // the line was running on the copy that dropped out: the copy taking over carries on
                if (Boolean.TRUE.equals(recordSide.runLatch) && !Boolean.TRUE.equals(line.runLatch)
                    && Boolean.TRUE.equals(desired.get("MesPermit"))) line.pulses.add("HmiStart");
            }
            recordSide = line;
        }
        for (int i = 0; i < c.length; i++) { lastRaw[i] = num(t, COUNTERS[i]); c[i] = Math.max(0, lastRaw[i] + offset[i]); lastCount[i] = c[i]; }
        return new PlcSnapshot(true, fieldLine ? "현장 PC OIP 연결 (웹 트윈 동기)" : "웹 트윈 PLC 연결", line.seen,
            num(t, "TargetQuantity"), c[0], c[1], c[2], c[3],
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
        // OIP Desktop stays the line through a reset (the twin keeps following it); its counts read as the old run until it clears
        twin.runLatch = null;
        field.runLatch = null;
        recordSide = null;
        java.util.Arrays.fill(lastCount, 0);
        java.util.Arrays.fill(offset, 0);
        java.util.Arrays.fill(lastRaw, 0);
        fieldVerdicts.clear();
        launchBase = 0;
        awaitingFieldReset = true;
        twin.tags = Map.of();
    }
    @Override public long resetTimeoutMs() { return 25000; }
    @Override public synchronized void resumeRun(boolean permitted, int target, int launched, int rejected, int packed, int exit) {
        desired.put("MesPermit", permitted);
        desired.put("TargetQuantity", target);
        int[] counts = {launched, rejected, packed, exit};
        System.arraycopy(counts, 0, lastCount, 0, counts.length);
        recordSide = new Side(); // whichever copy reports first is a take-over: its counts continue from these
    }
    @Override public void close() { }
}
