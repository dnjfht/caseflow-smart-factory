package kr.co.smartfactory.mes;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:mes-recovery;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=none",
    "mes.poll.enabled=false"
})
class MesRecoveryTest {
    @Autowired MesService mes;
    @Autowired JdbcTemplate db;
    @Autowired TransactionTemplate tx;

    @Test
    void restartedPlcCountsContinueOneOrderWithoutIssuingOldMaterialsAgain() {
        db.update("INSERT INTO mes_order(order_code,target_qty,status,last_launched,last_rejected,last_packed,last_exit," +
            "loaded_qty,run_base_launched,run_base_rejected,run_base_packed,run_base_exit) " +
            "VALUES ('RECOVER-3',3,'RUNNING',3,1,1,1,1,3,1,1,1)");
        db.update("UPDATE inventory SET quantity=1 WHERE sku='TRUCK'");
        PlcSnapshot finalScan = new PlcSnapshot(true,"test",Instant.now(),2,2,0,2,2,6,0,0,0,false,false);
        tx.executeWithoutResult(s -> mes.reconcile(finalScan));
        tx.executeWithoutResult(s -> mes.reconcile(finalScan));

        assertThat(db.queryForObject("SELECT status FROM mes_order WHERE order_code='RECOVER-3'",String.class))
            .isEqualTo("COMPLETE");
        assertThat(db.queryForObject("SELECT last_launched FROM mes_order WHERE order_code='RECOVER-3'",Integer.class))
            .isEqualTo(5);
        assertThat(db.queryForObject("SELECT last_exit FROM mes_order WHERE order_code='RECOVER-3'",Integer.class))
            .isEqualTo(3);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM material_issue WHERE order_id=1",Integer.class))
            .isEqualTo(4);
        assertThat(db.queryForObject("SELECT quantity FROM shipment WHERE order_id=1",Integer.class))
            .isEqualTo(3);
        assertThat(db.queryForObject("SELECT quantity FROM inventory WHERE sku='DISPATCHED'",Integer.class))
            .isEqualTo(3);
    }
}
