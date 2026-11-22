package kr.co.smartfactory.mes;

import jakarta.annotation.PostConstruct;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** One active work order and one shipment batch for the first vertical slice. */
@Service
public class MesService {
    private final JdbcTemplate db;
    private final PlcGateway plc;
    private final LotService lots;
    private final TransactionTemplate transactions;
    private volatile PlcSnapshot latest = PlcSnapshot.offline("아직 측정하지 않음");

    public MesService(JdbcTemplate db, PlcGateway plc, LotService lots, TransactionTemplate transactions) {
        this.db = db;
        this.plc = plc;
        this.lots = lots;
        this.transactions = transactions;
    }

    @PostConstruct
    public void seedDemoInventory() {
        for (String sku : List.of("BODY", "LID", "FINISHED", "REJECT", "TRUCK", "DISPATCHED")) {
            if (db.queryForObject("SELECT COUNT(*) FROM inventory WHERE sku=?", Integer.class, sku) == 0) {
                db.update("INSERT INTO inventory(sku,quantity) VALUES (?,?)", sku,
                    sku.equals("BODY") || sku.equals("LID") ? 20 : 0);
            }
        }
        lots.seedOpeningLots();
        for (Map<String,Object> order : db.queryForList("SELECT id,order_code,dispatched_qty FROM mes_order WHERE dispatched_qty>0")) {
            long id = ((Number)order.get("ID")).longValue();
            if (db.queryForObject("SELECT COUNT(*) FROM shipment WHERE order_id=?",Integer.class,id) == 0) {
                String code = (String)order.get("ORDER_CODE");
                db.update("INSERT INTO shipment(shipment_code,order_id,finished_lot_code,destination,quantity) " +
                    "VALUES (?,?,?,?,?)","SHIP-"+code,id,"FG-"+code,"미지정(초기 실측)",order.get("DISPATCHED_QTY"));
            }
        }
        for (Map<String,Object> o : db.queryForList("SELECT id,order_code,target_qty,last_launched,last_rejected,last_packed,last_exit,status FROM mes_order")) {
            long id=((Number)o.get("ID")).longValue();
            String code="FG-"+o.get("ORDER_CODE");
            if (db.queryForObject("SELECT COUNT(*) FROM production_lot WHERE order_id=?",Integer.class,id)==0)
                db.update("INSERT INTO production_lot(lot_code,order_id,product_sku,target_qty,launched_qty,good_qty,rejected_qty,shipped_qty,status) " +
                    "VALUES (?,?,'CASE',?,?,?,?,?,?)",code,id,o.get("TARGET_QTY"),o.get("LAST_LAUNCHED"),
                    o.get("LAST_PACKED"),o.get("LAST_REJECTED"),o.get("LAST_EXIT"),o.get("STATUS"));
        }
    }

    /** a restarted MES (a deploy) picks up the order in progress, so the line keeps its permit and its counts */
    @org.springframework.context.event.EventListener(org.springframework.boot.context.event.ApplicationReadyEvent.class)
    public void resumeOrderInProgress() {
        List<Map<String,Object>> rows = db.queryForList("SELECT * FROM mes_order WHERE status IN ('RUNNING','PAUSED') ORDER BY id DESC");
        if (rows.isEmpty()) return;
        Map<String,Object> o = rows.getFirst();
        java.util.function.ToIntFunction<String> n = k -> o.get(k) instanceof Number v ? v.intValue() : 0;
        plc.resumeRun("RUNNING".equals(o.get("STATUS")),
            n.applyAsInt("TARGET_QTY") - n.applyAsInt("RUN_BASE_EXIT"),
            n.applyAsInt("LAST_LAUNCHED") - n.applyAsInt("RUN_BASE_LAUNCHED"), n.applyAsInt("LAST_REJECTED") - n.applyAsInt("RUN_BASE_REJECTED"),
            n.applyAsInt("LAST_PACKED") - n.applyAsInt("RUN_BASE_PACKED"), n.applyAsInt("LAST_EXIT") - n.applyAsInt("RUN_BASE_EXIT"));
    }

    public void poll() {
        latest = plc.sample();
        if (latest.connected()) {
            transactions.executeWithoutResult(status -> reconcile(latest));
            try {
                plc.materialPermit(materialAvailable());
                plc.materialStock(inventoryQuantity("BODY"), inventoryQuantity("LID"));
            }
            catch (Exception e) { throw new IllegalStateException("PLC 자재 허가 쓰기 실패", e); }
        }
    }

    private boolean materialAvailable() {
        return db.queryForObject("SELECT MIN(CASE WHEN quantity>=1 THEN 1 ELSE 0 END) " +
            "FROM inventory WHERE sku IN ('BODY','LID')", Integer.class) == 1;
    }

    private int inventoryQuantity(String sku) {
        return db.queryForObject("SELECT quantity FROM inventory WHERE sku=?", Integer.class, sku);
    }

    private PlcSnapshot cleanLine(PlcSnapshot current) throws Exception {
        if (current.launched()==0 && current.rejected()==0 && current.packed()==0 && current.lineExit()==0) return current;
        plc.resetLine();
        for (int attempt=0;attempt<plc.resetTimeoutMs()/150;attempt++) {
            Thread.sleep(150);
            PlcSnapshot next=plc.sample();
            if (next.connected() && next.launched()==0 && next.rejected()==0 && next.packed()==0 && next.lineExit()==0) {
                latest=next;
                return next;
            }
        }
        throw new IllegalStateException("현장 수량 초기화 확인에 실패했습니다. 현장 연결 상태를 확인하세요.");
    }

    public PlcSnapshot plc() { return latest; }

    public List<Map<String,Object>> orders() {
        return db.queryForList("SELECT * FROM mes_order ORDER BY id DESC");
    }

    public List<Map<String,Object>> inventory() {
        return db.queryForList("SELECT sku,quantity FROM inventory ORDER BY sku");
    }

    public List<Map<String,Object>> events() {
        return db.queryForList("SELECT id,order_id,event_type,counter_value,occurred_at FROM mes_event ORDER BY id DESC LIMIT 50");
    }

    public List<Map<String,Object>> plans() {
        return db.queryForList("SELECT p.id,p.plan_code,p.product_sku,p.target_qty," +
            "CAST(p.planned_start AS VARCHAR) AS planned_start,CAST(p.planned_start_time AS VARCHAR) AS planned_start_time,CAST(p.due_date AS VARCHAR) AS due_date," +
            "p.destination,p.status,p.created_by,p.approved_by,p.approved_at,p.created_at,o.order_code FROM production_plan p " +
            "LEFT JOIN plan_order po ON po.plan_id=p.id " +
            "LEFT JOIN mes_order o ON o.id=po.order_id ORDER BY p.id DESC");
    }

    public List<Map<String,Object>> productionLots() {
        return db.queryForList("SELECT l.*,o.order_code FROM production_lot l " +
            "JOIN mes_order o ON o.id=l.order_id ORDER BY l.created_at DESC,l.lot_code DESC");
    }

    public List<Map<String,Object>> shipments() {
        return db.queryForList("SELECT s.*,o.order_code FROM shipment s " +
            "JOIN mes_order o ON o.id=s.order_id ORDER BY s.id DESC");
    }

    @Transactional
    public Map<String,Object> createPlan(String code, int target, LocalDate dueDate, String destination) {
        return createPlan(code,target,LocalDate.now(),dueDate,destination,"기획자 미지정");
    }

    @Transactional
    public Map<String,Object> createPlan(String code, int target, LocalDate plannedStart, LocalDate dueDate,
                                          String destination, String createdBy) {
        return createPlan(code,target,plannedStart,null,dueDate,destination,createdBy);
    }

    @Transactional
    public Map<String,Object> createPlan(String code, int target, LocalDate plannedStart, LocalTime plannedStartTime, LocalDate dueDate,
                                          String destination, String createdBy) {
        if (code == null || code.isBlank() || code.length() > 80 || target < 1 || target > 10000 ||
            dueDate == null || plannedStart == null || plannedStart.isAfter(dueDate) ||
            destination == null || destination.isBlank() || destination.length() > 120 ||
            createdBy == null || createdBy.isBlank() || createdBy.length() > 100)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "계획번호·목표 1~10,000개·작업일·납기·담당자를 확인하세요.");
        if (db.queryForObject("SELECT COUNT(*) FROM production_plan WHERE plan_code=?",Integer.class,code) != 0)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"생산계획 번호가 이미 존재합니다.");
        db.update("INSERT INTO production_plan(plan_code,product_sku,target_qty,planned_start,planned_start_time,due_date,destination,created_by,status) " +
            "VALUES (?,'CASE',?,?,?,?,?,?,'DRAFT')",code,target,plannedStart,plannedStartTime,dueDate,destination,createdBy);
        return db.queryForMap("SELECT * FROM production_plan WHERE plan_code=?",code);
    }

    @Transactional
    public Map<String,Object> approvePlan(long planId, String approver) {
        if (approver==null || approver.isBlank() || approver.length()>100)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"승인 담당자를 입력하세요.");
        List<Map<String,Object>> rows=db.queryForList("SELECT * FROM production_plan WHERE id=?",planId);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"생산계획을 찾지 못했습니다.");
        if (!"DRAFT".equals(rows.getFirst().get("STATUS")))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"작성 중인 계획만 승인할 수 있습니다.");
        db.update("UPDATE production_plan SET status='APPROVED',approved_by=?,approved_at=CURRENT_TIMESTAMP WHERE id=?",
            approver,planId);
        return db.queryForMap("SELECT * FROM production_plan WHERE id=?",planId);
    }

    @Transactional
    public Map<String,Object> releasePlan(long planId) {
        List<Map<String,Object>> rows = db.queryForList("SELECT * FROM production_plan WHERE id=?",planId);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"생산계획을 찾지 못했습니다.");
        Map<String,Object> plan = rows.getFirst();
        if (!"APPROVED".equals(plan.get("STATUS")))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"승인된 계획만 작업지시로 발행할 수 있습니다.");
        String orderCode = "WO-" + plan.get("PLAN_CODE");
        Map<String,Object> order = create(orderCode,((Number)plan.get("TARGET_QTY")).intValue());
        db.update("INSERT INTO plan_order(plan_id,order_id) VALUES (?,?)",planId,order.get("ID"));
        db.update("UPDATE production_plan SET status='RELEASED' WHERE id=?",planId);
        return order;
    }

    @Transactional
    public Map<String,Object> create(String code, int target) {
        if (code == null || code.isBlank() || code.length() > 80 || target < 1 || target > 10000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "이번 데모는 목표 양품 1~10,000개를 지원합니다.");
        }
        if (db.queryForObject("SELECT COUNT(*) FROM mes_order WHERE order_code=?",Integer.class,code) != 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,"작업번호가 이미 존재합니다.");
        }
        // Releasing an order only queues it. The single-active-order rule belongs to start.
        db.update("INSERT INTO mes_order(order_code,target_qty,status) VALUES (?,?,?)", code, target, "CREATED");
        long orderId=db.queryForObject("SELECT id FROM mes_order WHERE order_code=?",Long.class,code);
        db.update("INSERT INTO production_lot(lot_code,order_id,product_sku,target_qty) VALUES (?,?,'CASE',?)",
            "FG-"+code,orderId,target);
        return db.queryForMap("SELECT * FROM mes_order WHERE order_code=?", code);
    }

    @Transactional
    public Map<String,Object> command(long id, String action) {
        Map<String,Object> order = order(id);
        String state = (String) order.get("STATUS");
        PlcSnapshot s = plc.sample();
        if (!s.connected()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "OIP PLC 오프라인: " + s.message());
        try {
            switch (action) {
                case "start" -> {
                    if (!state.equals("CREATED")) throw new ResponseStatusException(HttpStatus.CONFLICT, "CREATED 작업만 시작할 수 있습니다.");
                    java.time.LocalDateTime due = plannedStart(id);
                    if (due != null && java.time.LocalDateTime.now(clock).isBefore(due))
                        throw new ResponseStatusException(HttpStatus.CONFLICT, "생산계획의 시작 예정 시각(" +
                            due.format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")) + ") 이후에 가동을 허가할 수 있습니다.");
                    if (db.queryForObject("SELECT COUNT(*) FROM mes_order WHERE status IN ('RUNNING','PAUSED')", Integer.class) != 0)
                        throw new ResponseStatusException(HttpStatus.CONFLICT, "현재 가동 중인 작업을 완료하거나 정지한 후 시작하세요.");
                    if (!materialAvailable()) throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "본체와 뚜껑 재고를 먼저 입고하세요.");
                    s=cleanLine(s);
                    plc.stop(true);
                    plc.target(((Number) order.get("TARGET_QTY")).intValue());
                    plc.materialPermit(true);
                    db.update("UPDATE mes_order SET status='RUNNING' WHERE id=?", id);
                    db.update("UPDATE production_plan SET status='RUNNING' WHERE id IN (SELECT plan_id FROM plan_order WHERE order_id=?)",id);
                    plc.stop(false);
                }
                case "pause" -> {
                    if (!state.equals("RUNNING")) throw new ResponseStatusException(HttpStatus.CONFLICT, "RUNNING 작업만 정지할 수 있습니다.");
                    plc.stop(true);
                    db.update("UPDATE mes_order SET status='PAUSED' WHERE id=?", id);
                }
                case "resume" -> {
                    if (!state.equals("PAUSED")) throw new ResponseStatusException(HttpStatus.CONFLICT, "PAUSED 작업만 재개할 수 있습니다.");
                    plc.stop(false);
                    db.update("UPDATE mes_order SET status='RUNNING' WHERE id=?", id);
                }
                case "recover" -> {
                    if (!state.equals("NEEDS_RESET")) throw new ResponseStatusException(HttpStatus.CONFLICT, "수량 초기화가 감지된 작업만 복구할 수 있습니다.");
                    if (db.queryForObject("SELECT COUNT(*) FROM mes_order WHERE status IN ('RUNNING','PAUSED')", Integer.class) != 0)
                        throw new ResponseStatusException(HttpStatus.CONFLICT, "다른 작업이 진행 중입니다.");
                    if (!materialAvailable()) throw new ResponseStatusException(HttpStatus.CONFLICT, "본체와 뚜껑 재고를 먼저 입고하세요.");
                    s=cleanLine(s);
                    int remaining = ((Number)order.get("TARGET_QTY")).intValue() - ((Number)order.get("LOADED_QTY")).intValue();
                    if (remaining <= 0) throw new ResponseStatusException(HttpStatus.CONFLICT, "남은 목표 양품 수량이 없습니다.");
                    plc.stop(true);
                    plc.target(remaining);
                    plc.materialPermit(true);
                    db.update("UPDATE mes_order SET run_base_launched=last_launched,run_base_rejected=last_rejected," +
                        "run_base_packed=last_packed,run_base_exit=last_exit,status='RUNNING' WHERE id=?",id);
                    db.update("UPDATE production_plan SET status='RUNNING' WHERE id IN (SELECT plan_id FROM plan_order WHERE order_id=?)",id);
                    event(id,"PLC_COUNTER_RECOVERED",remaining);
                    plc.stop(false);
                }
                case "close" -> {
                    // end an interrupted order with what it actually made: the loaded good products leave as a short shipment
                    if (!state.equals("PAUSED") && !state.equals("NEEDS_RESET"))
                        throw new ResponseStatusException(HttpStatus.CONFLICT, "정지(PAUSED)·NEEDS_RESET 작업만 현재 실적으로 마감할 수 있습니다.");
                    plc.stop(true);
                    int loaded = ((Number)order.get("LOADED_QTY")).intValue();
                    String orderCode = (String)order.get("ORDER_CODE");
                    if (loaded > 0) {
                        stock("TRUCK",-loaded); stock("DISPATCHED",loaded);
                        List<Map<String,Object>> planRows = db.queryForList("SELECT p.destination FROM production_plan p " +
                            "JOIN plan_order po ON po.plan_id=p.id WHERE po.order_id=?",id);
                        String destination = planRows.isEmpty() ? "미지정(직접 작업지시)" : (String)planRows.getFirst().get("DESTINATION");
                        db.update("INSERT INTO shipment(shipment_code,order_id,finished_lot_code,destination,quantity) VALUES (?,?,?,?,?)",
                            "SHIP-"+orderCode,id,"FG-"+orderCode,destination,loaded);
                    }
                    db.update("UPDATE mes_order SET status='COMPLETE',loaded_qty=0,dispatched_qty=? WHERE id=?",loaded,id);
                    db.update("UPDATE production_lot SET status='COMPLETE' WHERE order_id=?",id);
                    db.update("UPDATE production_plan SET status='COMPLETE' WHERE id IN (SELECT plan_id FROM plan_order WHERE order_id=?)",id);
                    event(id,"ORDER_CLOSED_WITH_ACTUAL",loaded);
                }
                default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "지원하지 않는 명령입니다.");
            }
        } catch (ResponseStatusException e) { throw e; }
        catch (Exception e) { throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "PLC 쓰기 실패: " + e.getMessage(), e); }
        return order(id);
    }

    /** the factory's wall clock: plan dates and times are entered in local (Korean) time, the server runs in UTC */
    private java.time.Clock clock = java.time.Clock.system(java.time.ZoneId.of("Asia/Seoul"));
    /** for tests: a method, so the call reaches the service behind Spring's transactional proxy */
    public void useClock(java.time.Clock c) { clock = c; }

    /** when the order's production plan is scheduled to start (a date without a time means that day's start), or null */
    java.time.LocalDateTime plannedStart(long orderId) {
        List<Map<String,Object>> rows = db.queryForList("SELECT CAST(p.planned_start AS VARCHAR) AS d, CAST(p.planned_start_time AS VARCHAR) AS t " +
            "FROM production_plan p JOIN plan_order po ON po.plan_id=p.id WHERE po.order_id=?", orderId);
        if (rows.isEmpty() || rows.getFirst().get("D") == null) return null;
        LocalDate day = LocalDate.parse(String.valueOf(rows.getFirst().get("D")).substring(0, 10));
        Object t = rows.getFirst().get("T");
        return day.atTime(t == null ? LocalTime.MIDNIGHT : LocalTime.parse(String.valueOf(t).substring(0, 5)));
    }

    private Map<String,Object> order(long id) {
        List<Map<String,Object>> rows = db.queryForList("SELECT * FROM mes_order WHERE id=?", id);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "작업지시를 찾지 못했습니다.");
        return rows.getFirst();
    }

    private void event(long id, String type, int counter) {
        db.update("INSERT INTO mes_event(order_id,event_type,counter_value) VALUES (?,?,?)", id, type, counter);
    }

    private void stock(String sku, int delta) {
        db.update("UPDATE inventory SET quantity=quantity+? WHERE sku=?", delta, sku);
    }

    public void reconcile(PlcSnapshot s) {
        List<Map<String,Object>> active = db.queryForList("SELECT * FROM mes_order WHERE status IN ('RUNNING','PAUSED') ORDER BY id LIMIT 1");
        if (active.isEmpty()) return;
        Map<String,Object> o = active.getFirst();
        long id = ((Number)o.get("ID")).longValue();
        int launched = ((Number)o.get("LAST_LAUNCHED")).intValue();
        int rejected = ((Number)o.get("LAST_REJECTED")).intValue();
        int packed = ((Number)o.get("LAST_PACKED")).intValue();
        int exited = ((Number)o.get("LAST_EXIT")).intValue();
        int liveLaunched = ((Number)o.get("RUN_BASE_LAUNCHED")).intValue() + s.launched();
        int liveRejected = ((Number)o.get("RUN_BASE_REJECTED")).intValue() + s.rejected();
        int livePacked = ((Number)o.get("RUN_BASE_PACKED")).intValue() + s.packed();
        int liveExit = ((Number)o.get("RUN_BASE_EXIT")).intValue() + s.lineExit();
        if (liveLaunched<launched || liveRejected<rejected || livePacked<packed || liveExit<exited) {
            db.update("UPDATE mes_order SET status='NEEDS_RESET' WHERE id=?", id);
            event(id,"PLC_COUNTER_RESET",0);
            return;
        }
        for (int n=launched+1;n<=liveLaunched;n++) {
            lots.issue(id,n,"BODY"); lots.issue(id,n,"LID");
            stock("BODY",-1); stock("LID",-1); event(id,"MATERIAL_CONSUMED",n);
        }
        for (int n=rejected+1;n<=liveRejected;n++) { stock("REJECT",1); event(id,"REJECTED",n); }
        for (int n=packed+1;n<=livePacked;n++) { stock("FINISHED",1); event(id,"PACKED",n); }
        for (int n=exited+1;n<=liveExit;n++) {
            stock("FINISHED",-1); stock("TRUCK",1); event(id,"LOADED_DIGITAL",n);
        }
        int loaded = ((Number)o.get("LOADED_QTY")).intValue() + liveExit - exited;
        int dispatched = ((Number)o.get("DISPATCHED_QTY")).intValue();
        int target = ((Number)o.get("TARGET_QTY")).intValue();
        String state = (String)o.get("STATUS");
        if (loaded >= target && dispatched == 0) {
            stock("TRUCK",-target); stock("DISPATCHED",target);
            event(id,"TRUCK_DEPARTED_DIGITAL",target);
            List<Map<String,Object>> planRows = db.queryForList("SELECT p.destination FROM production_plan p " +
                "JOIN plan_order po ON po.plan_id=p.id WHERE po.order_id=?",id);
            String destination = planRows.isEmpty() ? "미지정(직접 작업지시)" : (String)planRows.getFirst().get("DESTINATION");
            String orderCode = (String)o.get("ORDER_CODE");
            db.update("INSERT INTO shipment(shipment_code,order_id,finished_lot_code,destination,quantity) " +
                "VALUES (?,?,?,?,?)", "SHIP-"+orderCode,id,"FG-"+orderCode,destination,target);
            db.update("UPDATE production_plan SET status='COMPLETE' WHERE id IN " +
                "(SELECT plan_id FROM plan_order WHERE order_id=?)",id);
            dispatched=target; loaded-=target; state="COMPLETE";
            // the order is done: the MES withdraws the run permit, as the operator would with the permit-off button
            try { plc.stop(true); } catch (Exception e) { throw new IllegalStateException("PLC 허가 해제 실패", e); }
            event(id,"PERMIT_WITHDRAWN_ON_COMPLETE",target);
        }
        db.update("UPDATE mes_order SET last_launched=?,last_rejected=?,last_packed=?,last_exit=?,loaded_qty=?,dispatched_qty=?,status=? WHERE id=?",
            liveLaunched,liveRejected,livePacked,liveExit,loaded,dispatched,state,id);
        db.update("UPDATE production_lot SET launched_qty=?,good_qty=?,rejected_qty=?,shipped_qty=?,status=? WHERE order_id=?",
            liveLaunched,livePacked,liveRejected,liveExit,state,id);
    }
}
