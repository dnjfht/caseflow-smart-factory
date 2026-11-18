package kr.co.smartfactory.mes;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/robot")
public class RobotProgramController {
 private final JdbcTemplate db;
 public RobotProgramController(JdbcTemplate db){this.db=db;}
 public record Step(String name,List<Double> joints,double seconds){}
 @GetMapping("/program") public List<Map<String,Object>> program(){
  return db.queryForList("SELECT step_no,step_name,j1,j2,j3,j4,j5,j6,seconds FROM robot_step ORDER BY step_no");
 }
 private void idle(){
  if(db.queryForObject("SELECT COUNT(*) FROM mes_order WHERE status IN ('RUNNING','PAUSED')",Integer.class)>0 ||
     db.queryForObject("SELECT enabled OR preview_requested FROM robot_config WHERE id=1",Boolean.class))
   throw new ResponseStatusException(HttpStatus.CONFLICT,"생산·연동·시험 동작을 끝내고 편집하세요.");
 }
 @PostMapping("/program") @Transactional public List<Map<String,Object>> save(@RequestBody List<Step> steps){
  idle();
  if(steps.isEmpty()||steps.size()>8)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"동작은 1~8단계로 작성하세요.");
  double total=0;
  for(Step s:steps){
   if(s.name()==null||s.name().isBlank()||s.name().length()>80||s.joints()==null||s.joints().size()!=6||
      !Double.isFinite(s.seconds())||s.seconds()<2||s.seconds()>10||
      s.joints().stream().anyMatch(j->j==null||!Double.isFinite(j)||Math.abs(j)>170))
    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"6개 관절 각도(-170~170도)와 시간(2~10초)을 확인하세요.");
   total+=s.seconds();
  }
  if(total>14)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"PLC 30초 대기 한도에 맞춰 기본 이동 시간 합계를 14초 이하로 설정하세요.");
  db.update("DELETE FROM robot_step");int i=0;
  for(Step s:steps)db.update("INSERT INTO robot_step VALUES (?,?,?,?,?,?,?,?,?)",++i,s.name(),s.joints().get(0),s.joints().get(1),s.joints().get(2),s.joints().get(3),s.joints().get(4),s.joints().get(5),s.seconds());
  return program();
 }
 @PostMapping("/preview") public Map<String,Object> preview(){
  idle();
  if(program().isEmpty())throw new ResponseStatusException(HttpStatus.CONFLICT,"동작 순서를 먼저 저장하세요.");
  Map<String,Object> b=db.queryForMap("SELECT action_available,updated_at FROM robot_bridge_status WHERE id=1");
  if(!Boolean.TRUE.equals(b.get("ACTION_AVAILABLE"))||((java.sql.Timestamp)b.get("UPDATED_AT")).toInstant().isBefore(java.time.Instant.now().minusSeconds(12)))
   throw new ResponseStatusException(HttpStatus.CONFLICT,"Gazebo와 브리지를 먼저 실행하세요.");
  db.update("UPDATE robot_config SET preview_requested=TRUE WHERE id=1");return Map.of("message","Gazebo 시험 실행 요청됨");
 }
 @PostMapping("/preview-finished") public Map<String,Object> finished(){db.update("UPDATE robot_config SET preview_requested=FALSE WHERE id=1");return Map.of("ok",true);}
 @PostMapping("/viewer") public Map<String,Object> viewer() throws java.io.IOException {
  new ProcessBuilder("wsl","-d","Ubuntu","--","bash","-lc","source /opt/ros/jazzy/setup.bash && gz sim -g").redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
  return Map.of("message","Gazebo 별도 3D 창 열기를 요청했습니다.");
 }
}
