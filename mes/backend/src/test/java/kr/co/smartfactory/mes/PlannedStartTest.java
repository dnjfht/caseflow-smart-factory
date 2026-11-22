package kr.co.smartfactory.mes;
import static org.assertj.core.api.Assertions.*;
import java.time.*;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/** an order released from a plan may be permitted only once the plan's start time has come (Korean time) */
@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:planned-start;DB_CLOSE_DELAY=-1","spring.jpa.hibernate.ddl-auto=none","mes.poll.enabled=false"})
class PlannedStartTest {
 @Autowired MesService mes;
 @Autowired JdbcTemplate db;
 @Autowired PlcGateway plc;

 @Test void permitWaitsForThePlannedStart(){
  db.update("INSERT INTO production_plan(plan_code,product_sku,target_qty,due_date,destination,status,planned_start,planned_start_time) VALUES ('PS-1','CASE',3,DATE '2026-11-30','부산','RELEASED',DATE '2026-11-22',TIME '14:00:00')");
  db.update("INSERT INTO mes_order(order_code,target_qty,status) VALUES ('WO-PS-1',3,'CREATED')");
  long order=db.queryForObject("SELECT id FROM mes_order WHERE order_code='WO-PS-1'",Long.class);
  long plan=db.queryForObject("SELECT id FROM production_plan WHERE plan_code='PS-1'",Long.class);
  db.update("INSERT INTO plan_order(plan_id,order_id) VALUES (?,?)",plan,order);
  assertThat(mes.plannedStart(order)).isEqualTo(LocalDateTime.of(2026,11,22,14,0));

  ((TwinGateway)plc).syncTwin("browser",Map.of("LaunchedCount",0,"RejectCount",0,"ProducedCount",0,"ShippedCount",0,"RunLatch",false));
  ZoneId seoul=ZoneId.of("Asia/Seoul");
  mes.useClock(Clock.fixed(LocalDateTime.of(2026,11,22,9,30).atZone(seoul).toInstant(),seoul));
  try {
   assertThatThrownBy(()->mes.command(order,"start")).hasMessageContaining("2026-11-22 14:00");
   assertThat(db.queryForObject("SELECT status FROM mes_order WHERE id=?",String.class,order)).isEqualTo("CREATED");
  } finally { mes.useClock(Clock.system(seoul)); }
 }
 @Test void interruptedOrderClosesWithWhatItMade(){
  db.update("INSERT INTO mes_order(order_code,target_qty,status,last_exit,loaded_qty) VALUES ('WO-CLOSE-1',3,'PAUSED',2,2)");
  long order=db.queryForObject("SELECT id FROM mes_order WHERE order_code='WO-CLOSE-1'",Long.class);
  ((TwinGateway)plc).syncTwin("browser",Map.of("LaunchedCount",0,"RejectCount",0,"ProducedCount",0,"ShippedCount",0,"RunLatch",false));
  mes.command(order,"close");
  assertThat(db.queryForObject("SELECT status FROM mes_order WHERE id=?",String.class,order)).isEqualTo("COMPLETE");
  assertThat(db.queryForObject("SELECT quantity FROM shipment WHERE order_id=?",Integer.class,order)).isEqualTo(2);
 }
}
