package kr.co.smartfactory.mes;
import static org.assertj.core.api.Assertions.*;
import java.util.Map;
import kr.co.smartfactory.mes.AuthService.Role;
import kr.co.smartfactory.mes.AuthService.Need;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** sign-in, the role each change needs, and that a plan's author cannot approve it */
@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:auth;DB_CLOSE_DELAY=-1","spring.jpa.hibernate.ddl-auto=none","mes.poll.enabled=false"})
class AuthTest {
 @Autowired AuthService auth;
 @Autowired AuthInterceptor gate;
 @Autowired MesService mes;
 @Autowired JdbcTemplate db;

 String token(String user,String pw){ return String.valueOf(auth.login(user,pw).get("token")); }

 int call(String method,String path,String token) throws Exception {
  MockHttpServletRequest req=new MockHttpServletRequest(method,path);
  if(token!=null) req.addHeader("Authorization","Bearer "+token);
  MockHttpServletResponse res=new MockHttpServletResponse();
  return gate.preHandle(req,res,null)?200:res.getStatus();
 }

 @Test void demoAccountsSignInAndTokensCannotBeForged(){
  assertThat(auth.login("operator1","operator1234")).isNotNull();
  assertThat(auth.login("operator1","wrong")).isNull();
  String t=token("supervisor1","supervisor1234");
  assertThat(auth.verify(t).role()).isEqualTo(Role.SUPERVISOR);
  String body=t.substring(0,t.indexOf('.')),sig=t.substring(t.indexOf('.'));
  String forged=java.util.Base64.getUrlEncoder().withoutPadding().encodeToString("operator1\nADMIN\n9999999999\nx".getBytes())+sig;
  assertThat(auth.verify(forged)).isNull();
  assertThat(auth.verify(body+".AAAA")).isNull();
  assertThat(db.queryForObject("SELECT password_hash FROM mes_user WHERE username='admin'",String.class)).startsWith("pbkdf2$").doesNotContain("admin1234");
 }

 @Test void eachChangeNeedsItsRole() throws Exception {
  String op=token("operator1","operator1234"),sv=token("supervisor1","supervisor1234");
  assertThat(call("GET","/api/orders",null)).isEqualTo(200);                // anyone may look
  assertThat(call("POST","/api/twin/field-sync",null)).isEqualTo(200);      // the line's own link stays open
  assertThat(call("POST","/api/twin/press",null)).isEqualTo(401);           // start/stop needs a sign-in
  assertThat(call("POST","/api/twin/press",op)).isEqualTo(200);             // ... an operator may
  assertThat(call("POST","/api/plans",op)).isEqualTo(200);                  // an operator drafts plans
  assertThat(call("POST","/api/plans/1/approve",op)).isEqualTo(403);        // but does not approve them
  assertThat(call("POST","/api/plans/1/approve",sv)).isEqualTo(200);
  assertThat(call("POST","/api/orders/1/start",op)).isEqualTo(403);         // nor grant the MES permit
  assertThat(call("POST","/api/orders/1/start",sv)).isEqualTo(200);
  assertThat(call("POST","/api/some/new/endpoint",op)).isEqualTo(403);      // unknown changes default to a manager
  assertThat(call("GET","/api/auth/users",sv)).isEqualTo(403);
 }

 @Test void theAuthorOfAPlanCannotApproveIt(){
  Map<String,Object> p=mes.createPlan("AUTH-1",3,java.time.LocalDate.now(),null,java.time.LocalDate.now().plusDays(3),"부산","이반장 (supervisor1)");
  long id=((Number)p.get("ID")).longValue();
  assertThatThrownBy(()->mes.approvePlan(id,"이반장 (supervisor1)")).hasMessageContaining("직접 작성한 계획");
  assertThat(mes.approvePlan(id,"시스템관리자 (admin)").get("STATUS")).isEqualTo("APPROVED");
 }
}
