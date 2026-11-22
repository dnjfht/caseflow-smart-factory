package kr.co.smartfactory.mes;
import static org.assertj.core.api.Assertions.*;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * One copy of the line is the line (OIP Desktop when the field PC is connected, else the web twin); the twin follows
 * OIP Desktop as a mirror; counts carry on across a change of copy, a restart or a restarted MES.
 */
class TwinGatewayTest {
 static Map<String,Object> run(boolean latch,int shipped){
  Map<String,Object> t=new HashMap<>(Map.of("RunLatch",latch,"ShippedCount",shipped,"LaunchedCount",shipped,"ProducedCount",shipped,"RejectCount",0,"MesPermit",true));
  t.put("BodyConveyorRun",latch); t.put("RobotCommand",1);
  return t;
 }
 static void dropField(TwinGateway g) throws Exception {
  var f=TwinGateway.class.getDeclaredField("field"); f.setAccessible(true);
  var side=f.get(g); var seen=side.getClass().getDeclaredField("seen"); seen.setAccessible(true);
  seen.set(side, Instant.EPOCH);
 }

 static Map<String,Object> field(boolean latch,int launched,int inspected,boolean lastGood,int shipped,int target){
  Map<String,Object> t=run(latch,shipped); t.put("LaunchedCount",launched); t.put("InspectedCount",inspected);
  t.put("LastVerdictGood",lastGood); t.put("TargetQuantity",target); return t;
 }
 static Map<String,Object> twin(boolean latch,int launched,int inspected,int shipped){
  Map<String,Object> t=run(latch,shipped); t.put("LaunchedCount",launched); t.put("InspectedCount",inspected); return t;
 }
 @Test void withAFieldPcTheTwinFollowsOipDesktop(){
  TwinGateway g=new TwinGateway(); g.target(3); g.stop(false);
  g.syncField(field(false,0,0,false,0,3)); // the field PC comes online, then the desktop launches a set
  g.syncField(field(true,1,0,false,0,3));
  var reply=g.syncTwin("b",twin(false,0,0,0));
  assertThat(reply.mirror()).isNotNull();
  assertThat(reply.writes()).containsEntry("MirrorMode",true).containsEntry("MirrorLaunchLimit",1).containsEntry("TargetQuantity",30000)
    .containsEntry("MirrorVerdictReady",false);
  assertThat(reply.pulses()).containsExactly("HmiStart");            // the desktop runs: the twin runs too
  assertThat(reply.tags()).containsEntry("LaunchedCount",1);        // the panel shows the desktop's line
  assertThat(g.sample().launched()).isEqualTo(1);                   // and the MES counts it alone
 }
 @Test void theTwinTakesTheDesktopsVerdictForEachProductInOrder(){
  TwinGateway g=new TwinGateway(); g.target(3); g.stop(false);
  g.syncField(field(false,0,0,false,0,3));
  g.syncField(field(true,2,1,false,0,3));   // desktop: 1st product rejected
  g.syncField(field(true,3,2,true,1,3));    // desktop: 2nd product good
  var r0=g.syncTwin("b",twin(true,1,0,0));  // twin's 1st product
  assertThat(r0.writes()).containsEntry("MirrorVerdictReady",true).containsEntry("MirrorVerdictGood",false);
  var r1=g.syncTwin("b",twin(true,2,1,0));  // twin's 2nd product
  assertThat(r1.writes()).containsEntry("MirrorVerdictReady",true).containsEntry("MirrorVerdictGood",true);
  var r2=g.syncTwin("b",twin(true,3,2,1));  // twin's 3rd: the desktop has not judged it yet, so the twin waits
  assertThat(r2.writes()).containsEntry("MirrorVerdictReady",false);
 }
 @Test void anOrderStartsTheMirrorFromZero(){
  TwinGateway g=new TwinGateway(); g.target(2); g.stop(false);
  g.syncField(field(true,5,4,true,3,3)); g.syncTwin("b",twin(true,5,4,3));
  g.resetLine();
  // the desktop has not cleared its line yet: its old counts must not let the twin launch
  assertThat(g.syncTwin("b",twin(false,0,0,0)).writes()).containsEntry("MirrorLaunchLimit",0);
  g.syncField(field(false,0,0,false,0,2));
  g.syncField(field(true,1,0,false,0,2));
  assertThat(g.syncTwin("b",twin(false,0,0,0)).writes()).containsEntry("MirrorLaunchLimit",1);
 }
 @Test void withoutAFieldPcTheTwinIsTheLine(){
  TwinGateway g=new TwinGateway(); g.target(3); g.stop(false);
  var reply=g.syncTwin("b",run(true,2));
  assertThat(reply.mirror()).isNull();
  assertThat(g.sample().lineExit()).isEqualTo(2);
 }
 @Test void thePanelPressesTheLine(){
  TwinGateway g=new TwinGateway(); g.stop(false);
  g.syncField(run(false,0)); g.syncTwin("b",run(false,0));
  g.press("HmiStart");
  assertThat(g.syncField(run(false,0)).pulses()).containsExactly("HmiStart");
  assertThat(g.syncTwin("b",run(false,0)).pulses()).isEmpty();
  assertThatThrownBy(()->g.press("Reset")).isInstanceOf(IllegalArgumentException.class);
 }
 @Test void aFieldPcComingOnlineMakesTheTwinStartOverAsAMirror(){
  TwinGateway g=new TwinGateway();
  int before=g.syncTwin("b",run(false,0)).mirrorSeq();
  g.syncField(run(false,0));
  assertThat(g.syncTwin("b",run(false,0)).mirrorSeq()).isGreaterThan(before);
 }
 @Test void switchingCopiesKeepsCountsContinuous(){
  TwinGateway g=new TwinGateway();
  g.syncTwin("b",run(true,2)); assertThat(g.sample().lineExit()).isEqualTo(2);
  g.syncField(run(false,0)); assertThat(g.sample().lineExit()).isEqualTo(2); // field PC came online
  g.syncField(run(true,1));  assertThat(g.sample().lineExit()).isEqualTo(3);
 }
 @Test void theTwinFinishesTheOrderWhenTheFieldPcDropsOut() throws Exception {
  TwinGateway g=new TwinGateway(); g.target(3); g.stop(false);
  g.syncField(run(true,1)); g.syncTwin("b",run(false,0)); g.sample();
  dropField(g);
  g.syncTwin("b",run(false,0));
  assertThat(g.sample().lineExit()).isEqualTo(1);
  var reply=g.syncTwin("b",run(false,0));
  assertThat(reply.mirror()).isNull();
  assertThat(reply.pulses()).containsExactly("HmiStart");          // the line was running: the twin carries on
  assertThat(reply.writes().get("TargetQuantity")).isEqualTo(2);   // the two still needed
  g.syncTwin("b",run(true,2));
  assertThat(g.sample().lineExit()).isEqualTo(3);
 }
 @Test void aRestartedCopyCarriesOnCounting(){
  TwinGateway g=new TwinGateway(); g.target(10); g.stop(false);
  g.syncTwin("b",run(true,5)); assertThat(g.sample().lineExit()).isEqualTo(5);
  g.syncTwin("b",run(false,0)); assertThat(g.sample().lineExit()).isEqualTo(5); // reloaded / project re-read
  g.syncTwin("b",run(true,2)); assertThat(g.sample().lineExit()).isEqualTo(7);
 }
 @Test void newWorkOrderStartsFromZero(){
  TwinGateway g=new TwinGateway();
  g.syncTwin("b",run(true,5)); g.sample();
  g.resetLine();
  g.syncTwin("b",run(false,0));
  assertThat(g.sample().launched()).isZero();
 }
 @Test void aRestartedMesPicksUpTheOrderInProgress(){
  TwinGateway g=new TwinGateway();
  g.resumeRun(true,52,34,16,16,15);
  var reply=g.syncField(run(true,15));
  assertThat(reply.writes().get("MesPermit")).isEqualTo(true);
  var s=g.sample(); assertThat(s.lineExit()).isEqualTo(15); assertThat(s.launched()).isEqualTo(34);
  g.syncField(run(true,17)); assertThat(g.sample().lineExit()).isEqualTo(17);
 }
 @Test void theTwinFinishesItsLastProductsAfterTheDesktopIsDone(){
  TwinGateway g=new TwinGateway(); g.target(2); g.stop(false);
  g.syncField(field(false,0,0,false,0,2));
  g.syncField(field(true,2,2,true,2,2));
  g.stop(true); // the MES withdrew the permit: the order is complete
  Map<String,Object> desk=field(false,2,2,true,2,2); desk.put("MesPermit",false); g.syncField(desk);
  assertThat(g.syncTwin("b",twin(true,2,1,1)).writes()).containsEntry("MesPermit",true);   // its 2nd set still on the line
  assertThat(g.syncTwin("b",twin(false,2,2,2)).writes()).containsEntry("MesPermit",false); // caught up
 }
}
