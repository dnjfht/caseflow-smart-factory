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
}
