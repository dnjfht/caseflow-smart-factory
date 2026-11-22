package kr.co.smartfactory.mes;
import static org.assertj.core.api.Assertions.*;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** the line of record changing copy mid-order (field PC joins or drops) must not read as a counter reset */
class TwinGatewayTest {
 static Map<String,Object> tags(int launched,int packed){
  return Map.of("LaunchedCount",launched,"RejectCount",0,"ProducedCount",packed,"ShippedCount",packed,"RunLatch",true);
 }
 @Test void switchingCopiesKeepsCountsContinuous(){
  TwinGateway g=new TwinGateway();
  g.syncTwin("browser",tags(3,2));
  assertThat(g.sample().launched()).isEqualTo(3);
  g.syncField(tags(0,0)); // field PC joins with fresh counters: it becomes the line of record
  assertThat(g.sample().launched()).isEqualTo(3);
  assertThat(g.sample().packed()).isEqualTo(2);
  g.syncField(tags(1,1)); // and its production adds on top
  assertThat(g.sample().launched()).isEqualTo(4);
  assertThat(g.sample().packed()).isEqualTo(3);
 }
 @Test void newWorkOrderStartsFromZero(){
  TwinGateway g=new TwinGateway();
  g.syncTwin("browser",tags(5,5));
  g.sample();
  g.resetLine();
  g.syncTwin("browser",tags(0,0));
  assertThat(g.sample().launched()).isZero();
 }
 @Test void finishingOnOneCopyDoesNotStopTheOther(){
  TwinGateway g=new TwinGateway();
  g.syncField(Map.of("RunLatch",true,"TargetQuantity",1,"ShippedCount",0));
  g.syncTwin("browser",Map.of("RunLatch",true,"TargetQuantity",1,"ShippedCount",0));
  var r=g.syncTwin("browser",Map.of("RunLatch",false,"TargetQuantity",1,"ShippedCount",1)); // the twin finished first
  assertThat(g.syncField(Map.of("RunLatch",true,"TargetQuantity",1,"ShippedCount",0)).pulses()).isEmpty();
  g.syncTwin("browser",Map.of("RunLatch",true,"TargetQuantity",3,"ShippedCount",0));
  g.syncTwin("browser",Map.of("RunLatch",false,"TargetQuantity",3,"ShippedCount",0)); // a stop button
  assertThat(g.syncField(Map.of("RunLatch",true,"TargetQuantity",3,"ShippedCount",0)).pulses()).containsExactly("HmiStop");
 }
 static Map<String,Object> run(boolean latch,int shipped){
  return Map.of("RunLatch",latch,"ShippedCount",shipped,"LaunchedCount",shipped,"ProducedCount",shipped,"RejectCount",0,"MesPermit",true);
 }
 @Test void eachCopyAimsAtWhatTheOrderStillNeeds(){
  TwinGateway g=new TwinGateway(); g.target(3); g.stop(false);
  g.syncField(run(true,0)); g.syncTwin("b",run(true,0)); g.sample();
  // the twin runs ahead: it is not the line of record, so it keeps going until the order (counted on the field PC) is done
  g.syncField(run(true,1)); g.sample();
  assertThat(g.syncTwin("b",run(true,3)).writes().get("TargetQuantity")).isEqualTo(5);
  g.syncField(run(true,3)); g.sample();
  assertThat(g.syncTwin("b",run(true,3)).writes().get("TargetQuantity")).isEqualTo(3);
  assertThat(g.syncField(run(true,3)).writes().get("TargetQuantity")).isEqualTo(3);
 }
 @Test void theTwinFinishesTheOrderWhenTheFieldPcDropsOut() throws Exception {
  TwinGateway g=new TwinGateway(); g.target(3); g.stop(false);
  g.syncField(run(true,1)); g.syncTwin("b",run(false,3)); g.sample(); // the twin had stopped at its own count
  var f=TwinGateway.class.getDeclaredField("field"); f.setAccessible(true);
  var side=f.get(g); var seen=side.getClass().getDeclaredField("seen"); seen.setAccessible(true);
  seen.set(side, java.time.Instant.EPOCH); // field PC gone
  g.syncTwin("b",run(false,3));
  assertThat(g.sample().lineExit()).isEqualTo(1);
  var reply=g.syncTwin("b",run(false,3));
  assertThat(reply.pulses()).containsExactly("HmiStart");
  assertThat(reply.writes().get("TargetQuantity")).isEqualTo(5); // two more on the twin's own counter
  g.syncTwin("b",run(true,5));
  assertThat(g.sample().lineExit()).isEqualTo(3);
 }
 @Test void aReloadedTwinCarriesOnCounting(){
  TwinGateway g=new TwinGateway(); g.target(10); g.stop(false);
  g.syncTwin("b",run(true,5)); assertThat(g.sample().lineExit()).isEqualTo(5);
  g.syncTwin("b",run(false,0)); assertThat(g.sample().lineExit()).isEqualTo(5); // the page was reloaded
  g.syncTwin("b",run(true,2)); assertThat(g.sample().lineExit()).isEqualTo(7);
 }
 @Test void aCopyJoiningARunningLineStartsToo(){
  TwinGateway g=new TwinGateway(); g.target(3); g.stop(false);
  g.syncField(run(true,1)); g.syncField(run(true,1));
  assertThat(g.syncTwin("b",run(false,0)).pulses()).containsExactly("HmiStart");
 }
}
