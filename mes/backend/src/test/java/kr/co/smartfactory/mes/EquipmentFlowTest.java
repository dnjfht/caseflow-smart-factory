package kr.co.smartfactory.mes;
import static org.assertj.core.api.Assertions.*;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/** a part wears out: the line stops on both copies, 잠금 → 수리 → 확인 renews it and the line starts again */
@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:equip;DB_CLOSE_DELAY=-1","spring.jpa.hibernate.ddl-auto=none",
 "mes.poll.enabled=false","mes.plc.mode=twin"})
class EquipmentFlowTest {
 @Autowired EquipmentService equipment;
 @Autowired MesService mes;
 @Autowired PlcGateway plc;
 @Autowired JdbcTemplate db;

 TwinGateway.SyncReply report(int launched){
  TwinGateway g=(TwinGateway)plc;
  Map<String,Object> t=TwinGatewayTest.field(true,launched,0,true,0,30);
  t.put("EquipmentFault",0);
  TwinGateway.SyncReply r=g.syncField(t);
  mes.poll(); equipment.tick();
  return r;
 }

 @Test void aWornPartStopsTheLineUntilItsRepairIsConfirmed(){
  TwinGateway g=(TwinGateway)plc;
  g.stop(false); // an order's permit is on
  report(0);
  equipment.wearOut("BEARING_WEAR",2);
  report(4);                                                       // 4 cases launched: the bearing fails
  Map<String,Object> f=db.queryForMap("SELECT * FROM equipment_fault ORDER BY id DESC LIMIT 1");
  assertThat(f.get("STATUS")).isEqualTo("LOCKED");
  assertThat(f.get("MODE_CODE")).isEqualTo("BEARING_WEAR");
  var r=report(6);
  assertThat(r.writes()).containsEntry("EquipmentFault",81);             // OIP Desktop gets the fault code: the PLC stops
  Map<String,Object> t=TwinGatewayTest.twin(true,0,0,0); t.put("EquipmentFault",0);
  assertThat(g.syncTwin("b",t).writes()).containsEntry("EquipmentFault",81); // and so does the web twin
  long id=((Number)f.get("ID")).longValue();
  assertThatThrownBy(()->equipment.confirm(id,"x")).hasMessageContaining("수리 중인");   // 확인 only after 수리
  equipment.startRepair(id,"박정비 (maint1)");
  assertThat(equipment.fault(id).get("STATUS")).isEqualTo("REPAIRING");
  assertThat(report(6).writes()).containsEntry("EquipmentFault",81);     // still stopped while being repaired
  equipment.confirm(id,"박정비 (maint1)");
  assertThat(equipment.fault(id).get("STATUS")).isEqualTo("CONFIRMED");
  assertThat(db.queryForObject("SELECT used FROM equipment_life WHERE mode_code='BEARING_WEAR'",Double.class)).isZero(); // renewed
  var after=report(6);
  assertThat(after.writes()).containsEntry("EquipmentFault",0);          // cleared
  assertThat(after.pulses()).contains("HmiStart");                  // and the line is started again
 }

 @Test void preventiveServiceAlsoStopsAndRenewsTheWholeAsset(){
  ((TwinGateway)plc).stop(false);
  report(0);
  Map<String,Object> f=equipment.preventive("ROBOT","박정비 (maint1)");
  long id=((Number)f.get("ID")).longValue();
  assertThat(report(2).writes()).containsEntry("EquipmentFault",90);
  assertThatThrownBy(()->equipment.preventive("SEALER","x")).hasMessageContaining("처리 중인 정비");
  equipment.startRepair(id,"x"); equipment.confirm(id,"x");
  assertThat(db.queryForObject("SELECT MAX(used) FROM equipment_life WHERE asset_code='ROBOT'",Double.class)).isZero();
 }
}
