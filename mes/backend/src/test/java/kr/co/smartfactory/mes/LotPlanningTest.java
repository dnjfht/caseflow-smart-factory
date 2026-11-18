package kr.co.smartfactory.mes;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:mes-lot-plan;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=none",
    "mes.poll.enabled=false"
})
class LotPlanningTest {
    @Autowired MesService mes;
    @Autowired LotService lots;
    @Autowired JdbcTemplate db;
    @Autowired TransactionTemplate tx;

    @Test
    void threeHundredUnitPlanCanBeSavedAndListed() {
        var plan=mes.createPlan("PLAN-300",300,LocalDate.now(),java.time.LocalTime.of(20,30),LocalDate.now(),"고객사 물류센터","계획담당자");
        assertThat(plan.get("TARGET_QTY")).isEqualTo(300);
        assertThat(mes.plans().stream().filter(row->"PLAN-300".equals(row.get("PLAN_CODE"))).findFirst().orElseThrow().get("TARGET_QTY")).isEqualTo(300);
    }

    @Test
    void tenThousandFiveHundredUnitReceiptGetsAutomaticLotAndUpdatesInventory() {
        int before=db.queryForObject("SELECT quantity FROM inventory WHERE sku='BODY'",Integer.class);
        Map<String,Object> receipt=lots.receive("  ","BODY",10500,"정확한 공급처 모름","국내 입고","입고 담당자");
        String code=(String)receipt.get("LOT_CODE");
        assertThat(code).startsWith("BODY-"+LocalDate.now().format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE)+"-");
        assertThat(receipt.get("RECEIVED_QTY")).isEqualTo(10500);
        assertThat(receipt.get("AVAILABLE_QTY")).isEqualTo(10500);
        assertThat(db.queryForObject("SELECT quantity FROM inventory WHERE sku='BODY'",Integer.class)).isEqualTo(before+10500);
        assertThat(lots.lots().getFirst().get("LOT_CODE")).isEqualTo(code);
    }

    @Test
    void receiptCannotOverflowOipStockDisplay() {
        assertThatThrownBy(() -> lots.receive("BODY-OVERFLOW","BODY",Short.MAX_VALUE,"공급처","국내 입고","입고 담당자"))
            .hasMessageContaining("32,767");
    }

    @Test
    void plannedStartTimeIsStoredAndBlocksEarlyRelease() {
        LocalDateTime start = LocalDateTime.now().plusHours(2);
        Map<String,Object> plan = mes.createPlan("PLAN-TIMED",1,start.toLocalDate(),start.toLocalTime(),start.toLocalDate(),"고객사 시험센터","생산계획 담당자");
        long planId = ((Number)plan.get("ID")).longValue();
        mes.approvePlan(planId,"생산팀장");
        assertThat(mes.plans().stream().filter(row -> "PLAN-TIMED".equals(row.get("PLAN_CODE"))).findFirst().orElseThrow().get("PLANNED_START_TIME")).isNotNull();
        assertThatThrownBy(() -> mes.releasePlan(planId)).hasMessageContaining("예정");
    }

    @Test
    void planAndReceivedLotTraceToShipmentDestination() {
        Map<String,Object> plan = mes.createPlan("PLAN-TEST",1, LocalDate.now().plusDays(1),"고객사 서울센터");
        long planId = ((Number)plan.get("ID")).longValue();
        assertThat(plan.get("STATUS")).isEqualTo("DRAFT");
        mes.approvePlan(planId,"생산팀장");
        Map<String,Object> order = mes.releasePlan(planId);
        long orderId = ((Number)order.get("ID")).longValue();
        assertThat(order.get("ORDER_CODE")).isEqualTo("WO-PLAN-TEST");
        db.update("UPDATE mes_order SET status='RUNNING' WHERE id=?",orderId);

        PlcSnapshot scan = new PlcSnapshot(true,"test",Instant.now(),1,1,0,1,1,6,0,0,0,false,false);
        tx.executeWithoutResult(s -> mes.reconcile(scan));
        tx.executeWithoutResult(s -> mes.reconcile(scan));

        assertThat(db.queryForObject("SELECT status FROM production_plan WHERE id=?",String.class,planId)).isEqualTo("COMPLETE");
        assertThat(db.queryForObject("SELECT destination FROM shipment WHERE order_id=?",String.class,orderId)).isEqualTo("고객사 서울센터");
        assertThat(db.queryForObject("SELECT status FROM production_lot WHERE order_id=?",String.class,orderId)).isEqualTo("COMPLETE");
        assertThat(lots.backward("WO-PLAN-TEST")).hasSize(2);
        assertThat(lots.forward("OPEN-BODY-001")).hasSize(1);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM material_issue",Integer.class)).isEqualTo(2);
        int before=db.queryForObject("SELECT quantity FROM inventory WHERE sku='BODY'",Integer.class);
        lots.receive("BODY-NEW-001","BODY",5,"협력사 B","부산 입고");
        assertThat(db.queryForObject("SELECT quantity FROM inventory WHERE sku='BODY'",Integer.class)).isEqualTo(before+5);
    }
}
