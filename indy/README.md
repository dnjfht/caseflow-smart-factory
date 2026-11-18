# INDY7 · OIP PLC 연동 시뮬레이션

## 검증 결과 (2026-11-18)

공식 [Neuromeka indy-ros2 `jazzy-indyDCP3`](https://github.com/neuromeka-robotics/indy-ros2/tree/jazzy-indyDCP3)로 WSL Ubuntu 24.04 / ROS 2 Jazzy / Gazebo에서 Indy7을 구동했다. `indy_motion_smoke.py`의 관절 목표 2개가 모두 성공했다.

실제 OIP `RobotStart` 신호를 `indy_plc_bridge.py`가 OPC UA로 읽어 ROS 2 `FollowJointTrajectory` 왕복 동작을 요청했다. 두 목표가 끝난 뒤 PLC에 `IndyDone`을 기록했다. MES 시험 작업 `INDY-LIVE-001`은 투입 1 → 불량 0 → 양품 포장 1 → 출구 1 → 출고 1로 완료했고, INDY 완료 동작은 1회 기록됐다. OIP 기본 6축 로봇의 완료도 별도로 확인해야 조립 배출되는 선택형 회로다. 기본 설정은 **연동 꺼짐**이다.

INDY 궤적은 **관절 동작 증명용**이며 OIP의 뚜껑 픽업 좌표, 그리퍼, 실제 제품 물체와 보정되지 않았다. 실제 INDY 하드웨어를 제어한 기록은 아니다.

## 역할과 PLC 신호

| 신호 | 방향 | 목적 |
|---|---|---|
| `RobotStart` / `%QX0.6` | OIP PLC → 브리지 | 조립 단계에서 상승 에지로 INDY 동작 시작 |
| `RobotDone` / `%IX0.7` | OIP 기본 로봇 → PLC | 3D 물체 픽 앤 플레이스 완료 |
| `IndyBridgeEnabled` | 브리지 → PLC | 선택형 INDY 완료 대기 켜기 |
| `IndyDone` | 브리지 → PLC | ROS 2 관절 목표 2개 성공 |
| `IndyFault` | 브리지 → PLC | 궤적 실패·명령 서버 오류 |
| `FaultCode` 71/72 | PLC 내부 | INDY 오류/완료 시간 초과; 자동 신규 투입 차단 |

MES 설비·로봇 페이지에서 승인된 데모 동작과 속도(50/75/100%)를 저장하고 OIP·Gazebo·브리지 연결 상태를 확인한 뒤 활성화한다. 작업이 이미 시작됐을 때는 설정을 바꿀 수 없다. MES는 로봇 관절을 직접 조그하지 않으며 PLC 시작·완료·오류 및 동작 설정·상태를 관리한다. 실제 현장에서도 로봇 자세와 경로는 로봇 담당자가 검증해 로봇 컨트롤러에 저장하고 PLC가 사이클 시작·완료·오류를 교환하는 방식이 적절하다.

## 재실행 순서

1. OIP Desktop에서 `../SmartFactory_CaseAssembly_Final`을 열고 Play. 로컬 OPC UA `127.0.0.1:4843` 확인.
2. MES 백엔드·웹 실행. 웹 `설비 · 로봇`에서 INDY 연동이 꺼져 있는지 확인.
3. WSL: `source /opt/ros/jazzy/setup.bash && source /home/dnjfht/indy-ros2/install/setup.bash && ros2 launch indy_gazebo indy_gazebo.launch.py indy_type:=indy7 launch_rviz:=false`.
4. WSL `ip route show default`에서 `via` 뒤의 윈도우 WSL 어댑터 IP 확인. Windows에서 같은 IP로 `python wsl_opc_relay.py --bind <IP>` 실행. 릴레이는 **WSL 가상 어댑터에만** 바인딩해 OIP의 loopback OPC UA 서버에 전달한다. 재시작 때 WSL 주소가 바뀔 수 있다.
5. WSL: `source /opt/ros/jazzy/setup.bash && source /home/dnjfht/indy-ros2/install/setup.bash && /home/dnjfht/indy-ros2/bridge-venv/bin/python <이 폴더의 WSL 경로>/indy_plc_bridge.py --opc opc.tcp://<IP>:4844`. 첫 설치에만 `python3 -m venv --system-site-packages /home/dnjfht/indy-ros2/bridge-venv`와 해당 환경의 `pip install asyncua`가 필요하다.
6. MES 설비·로봇 페이지에서 Gazebo/OIP/브리지가 준비됨인지 확인하고 승인된 데모 동작·속도를 저장, 연동 활성화. OIP Stop→Play로 새 작업 카운터 초기화 후 새 작업지시를 PLC 시작한다. `MOVING → COMPLETE → READY`, 완료 회수 증가와 포장·출고를 확인한다. 시험 후 연동 해제.

Windows MES·OIP와 WSL Gazebo/브리지/릴레이 프로세스는 컴퓨터 재시작 후 자동으로 올라오지 않는다. 위 순서를 다시 실행해야 한다.

## 다음 구현

- 제품 좌표계/그리퍼를 보정하고 OIP에서 실제 뚜껑을 잡는 동작을 INDY 궤적과 일치시키기.
- PLC/로봇 사이클 ID, 명령·수락·완료·오류 시각을 MES 이벤트에 저장하고 재시도·비상정지 절차 검증.
- 로봇 동작 중 통신 단절과 30초 시간 초과의 실제 OIP 시험, 초기화·수리 후 재가동 절차.

## 처음 사용하는 사람을 위한 Gazebo·MES 조작 순서

1. 위 재실행 순서의 3번 명령을 WSL 터미널에서 실행하면 Gazebo 안에 Indy7이 나타난다. Gazebo의 **Play**를 켜 시뮬레이션 시간을 진행시킨다. Space 키도 일시 정지·재개에 사용한다. 마우스로 시야를 옮겨 로봇 관절이 보이게 한다. Gazebo의 Reset은 새 시험이 필요할 때만 사용한다.
2. WSL 릴레이와 `indy_plc_bridge.py`를 실행한 뒤 MES **설비 · 로봇**에서 OIP, Gazebo, 브리지 세 연결 상태를 확인한다. **INDY 동작 순서 편집**에서 단계 이름, 여섯 관절 각도(도), 이동 시간(초), 순서를 조정하고 저장한 뒤 **Gazebo 시험 실행**으로 확인한다. 필요하면 **Gazebo 3D 창 열기**를 누른다. 이 편집기는 관절 공간 데모이며 TCP, 픽업 위치, 그리퍼, 충돌 경로를 만드는 전문 로봇 프로그래밍 화면은 아니다.
3. MES에서 로봇 연동을 활성화하고 승인·발행된 작업지시를 시작한다. OIP의 `RobotStart`가 올라가면 브리지가 Gazebo `FollowJointTrajectory` 액션을 호출한다. MES에서 `MOVING → COMPLETE → READY`와 완료 횟수 증가를 보고, OIP에서 `IndyDone` 뒤 조립품 배출을 확인한다.
4. 공정 · 3D 현장 메뉴는 OIP의 실제 화면과 PLC 공정값을 보여준다. MES 정지·재가동은 작업을 통해 PLC로 전달된다. Gazebo 화면은 현재 별도 창이다. OIP와 Gazebo의 로봇은 동작 완료 신호로 연결돼 있으며 같은 3D 공간·그리퍼 물체를 공유하지 않는다.
5. Gazebo에서 로봇 동작을 별도로 연습하려면 공식 패키지의 `ros2 launch indy_moveit indy_moveit_gazebo.launch.py indy_type:=indy7`으로 MoveIt을 띄워 목표 관절 자세와 경로를 계획한다. 생산 중인 MES 작업과 동시에 별도 명령을 보내면 순서가 충돌할 수 있으므로 데모 작업이 없는 상태에서 연습한다.

**화면에서 확인할 기준:** Gazebo에서 로봇 관절이 두 목표를 왕복하고, MES의 완료 횟수가 증가하며, OIP는 뚜껑 결합 후 검사·포장·출고로 넘어가야 한다. Gazebo에서만 움직이거나 MES에서만 수치가 바뀌면 브리지 상태와 OIP `RobotStart`/`IndyDone`을 각각 확인한다. 로봇이 움직여도 실제 뚜껑을 Gazebo에서 집는 것으로 설명하지 않는다.

**OIP 화면 연결:** OIP 설정의 **Agent connections → Allow AI agents to connect**를 켜면 이 PC의 프로그램이 열린 OIP 프로젝트를 읽고 조작할 수 있다. MES는 이 로컬 연결에서 3초마다 현장 화면을 받아 공정 · 3D 현장에 보여준다. OIP 창을 최소화하거나 닫으면 현재 OIP 구현이 시뮬레이션을 일시 정지하거나 화면 수집을 중단하므로 창을 열린 상태로 둔다. 이 설정은 시연이 끝나면 끌 수 있다.

참고: [Neuromeka 공식 Indy ROS2](https://github.com/neuromeka-robotics/indy-ros2/tree/jazzy-indyDCP3), [Gazebo 공식 GUI 안내](https://gazebosim.org/docs/latest/gui/).
