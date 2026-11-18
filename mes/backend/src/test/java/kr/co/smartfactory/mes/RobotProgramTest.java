package kr.co.smartfactory.mes;
import static org.assertj.core.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:robot-program;DB_CLOSE_DELAY=-1","spring.jpa.hibernate.ddl-auto=none","mes.poll.enabled=false"})
@Transactional
class RobotProgramTest {
 @Autowired RobotProgramController robot;
 @Autowired JdbcTemplate db;
 RobotProgramController.Step step(double seconds){return new RobotProgramController.Step("시험",List.of(0d,0d,-90d,0d,-90d,0d),seconds);}
 @Test void invalidProgramDoesNotOverwriteSavedSteps(){
  robot.save(List.of(step(4)));
  assertThatThrownBy(()->robot.save(List.of(step(8),step(8)))).hasMessageContaining("14초");
  assertThat(robot.program()).hasSize(1);
 }
 @Test void runningOrEnabledRobotCannotBeEdited(){
  db.update("UPDATE robot_config SET enabled=TRUE WHERE id=1");
  assertThatThrownBy(()->robot.save(List.of(step(4)))).hasMessageContaining("편집");
 }
}
