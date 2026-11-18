package kr.co.smartfactory.mes;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:mes-reconciliation;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=none",
    "mes.poll.enabled=false"
})
class MesReconciliationTest {
    @Autowired MesService mes;
    @Autowired JdbcTemplate db;
    @Autowired TransactionTemplate tx;

    @Test
    void fiveKitsTwoRejectsThreePackedAndLoadedDispatchExactlyOnce() {
        db.update("INSERT INTO mes_order(order_code,target_qty,status) VALUES ('TEST-3',3,'RUNNING')");
        PlcSnapshot finalScan = new PlcSnapshot(true,"test",Instant.now(),3,5,2,3,3,6,0,0,0,false,false);
        tx.executeWithoutResult(s -> mes.reconcile(finalScan));
        tx.executeWithoutResult(s -> mes.reconcile(finalScan));

        assertThat(quantity("BODY")).isEqualTo(15);
        assertThat(quantity("LID")).isEqualTo(15);
        assertThat(quantity("REJECT")).isEqualTo(2);
        assertThat(quantity("FINISHED")).isZero();
        assertThat(quantity("TRUCK")).isZero();
        assertThat(quantity("DISPATCHED")).isEqualTo(3);
        assertThat(db.queryForObject("SELECT status FROM mes_order WHERE order_code='TEST-3'",String.class)).isEqualTo("COMPLETE");
        assertThat(db.queryForObject("SELECT COUNT(*) FROM mes_event",Integer.class)).isEqualTo(14);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM material_issue",Integer.class)).isEqualTo(10);
        assertThat(db.queryForObject("SELECT available_qty FROM material_lot WHERE sku='BODY'",Integer.class)).isEqualTo(15);
        assertThat(db.queryForObject("SELECT quantity FROM shipment WHERE order_id=1",Integer.class)).isEqualTo(3);
    }

    private int quantity(String sku) {
        return db.queryForObject("SELECT quantity FROM inventory WHERE sku=?",Integer.class,sku);
    }
}
