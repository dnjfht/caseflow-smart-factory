# CASEFLOW | 소형 케이스 조립·검사·포장 MES

본체와 뚜껑을 반복 공급하고 로봇으로 조립한 뒤, 검사 결과에 따라 불량품을 분류하거나 양품을 포장·출고하는 공정입니다. 작업지시의 **목표 양품 수량**에 도달할 때까지 불량품 수만큼 다음 세트를 보충합니다.

**공개 웹:** https://caseflow-smart-factory.onrender.com — MES 화면 안에서 3D 가상 공정(웹 트윈)과 PLC가 브라우저에서 실제로 돌아갑니다.

## 구성

| 폴더 | 내용 |
|---|---|
| `oip/project` | 가상 공정의 기준: 현장 배치(`scene.json`), 센서·출력 배선, IEC 61131-3 ST 제어 프로그램(`plc/program.st`), 공정 시험 5종 |
| `twin` | 웹 트윈 빌드: Open Industry Project(OIP) 브라우저판 고정 커밋 + CaseFlow 패치 + 빌드 스크립트 |
| `plc/openplc-editor` | OpenPLC Editor 래더 프로젝트(`main.ld`, 58 렁)와 장치 설정 |
| `mes/backend` | Spring Boot API, PLC 수집(OPC UA), 작업지시·BOM·LOT·자재·품질·출고 이력 |
| `mes/web` | React MES 화면, 웹 트윈 프레임, 현장 조작반, 협동로봇 티치펜던트 |
| `indy` | ROS 2 Indy7·Gazebo 연동 실험(선택 사항, 메인 시연 경로 아님) |
| `oip/background-runtime.patch` | OIP 데스크톱을 최소화해도 시뮬레이션이 멈추지 않게 하는 패치 |
| `scripts/start-local.ps1` | 로컬에서 OIP 데스크톱·MES를 함께 기동 |
| `images` · `docs` | 포트폴리오 이미지, 진행 정리본·인수인계서, 라이선스 |

## 가동 방식: MES는 허가, 현장은 버튼

실제 라인처럼 MES는 **가동 허가와 목표 수량만** PLC에 내립니다. 공정은 현장의 **시작 버튼**을 눌러야 돌고, 허가가 없으면 버튼을 눌러도 돌지 않습니다.

| 신호 | 의미 |
|---|---|
| `MesPermit` | MES 가동 허가 (작업지시 `가동 허가` 버튼) |
| `StartPB %IX0.0` / `HmiStart` | 현장 시작 버튼 (3D 장면의 초록 버튼 / MES의 현장 조작반) |
| `StopPB %IX0.1` / `HmiStop` | 현장 정지 버튼 |
| `RunLatch` → `M0` | 허가 + 시작 버튼으로 걸리는 운전 자기유지. 정지 버튼·허가 해제·고장·목표 달성 시 해제 |
| `PermitLamp %QX2.1` | 허가가 있고 시작 대기 중일 때 시작 버튼 램프 점등 |
| `MachineState` | 1 대기 · 2 가동 · 3 허가됨(시작 대기) · 4 정지 · 5 고장 · 6 목표 완료 |

같은 규칙이 OIP 데스크톱, 웹 트윈, 래더(`WorkOrderActive` AND `StartPB` → SET `M0`) 모두에 적용됩니다. `oip/project/tests`의 시험 5종이 이를 검증합니다(허가만으로는 안 돌고, 시작 버튼이어야 도는지 포함).

## 웹 트윈

`twin/`은 OIP 브라우저판(MIT, 고정 커밋 `twin/OIP_COMMIT`)에 작은 패치(`twin/caseflow-twin.patch`)를 적용해 빌드합니다. 패치는 세 가지만 합니다.

1. `/app/?scene=caseflow`로 열면 `oip/project`(압축본 `/caseflow/caseflow.oip`)를 바로 불러와 실행합니다. OIP 데스크톱과 **같은 장면·같은 ST 프로그램**입니다.
2. 같은 출처의 MES 페이지가 쓰는 `window.caseflow` API를 엽니다: PLC 태그 읽기, 허가·버튼 쓰기, 로봇 관절 읽기·조그·작업 실행·프로그램 적용, 카메라 위치.
3. 서비스 워커를 끕니다(사이트 전체를 가로채지 않도록).

Render 빌드(`mes/web`의 `npm run build`)가 `twin/build-twin.mjs`를 실행해 트윈을 MES 사이트에 함께 넣습니다. 로컬에서는 `BUILD_TWIN=1`일 때만 빌드합니다.

## 협동로봇 티치펜던트

MES `설비 · 로봇` 화면에서 조립 로봇(6축)을 협동로봇 앱처럼 다룹니다: 관절별 조그(1°/5°/10°), 웨이포인트 저장·추가, 조립 작업(Job 1) 순서 편집(이동·흡착·대기·신호), 1회 시험 실행, 공정에 적용. 공정 가동 중에는 수동 조작이 잠기고, 관절 한계를 넘는 값은 이동하지 않습니다. 적용한 순서는 PLC가 다음 조립부터 실행합니다.

## 로컬 실행 (OIP 데스크톱 + MES 서버)

1. Java 25, Node.js, `oip/background-runtime.patch`가 적용된 OIP 실행본을 준비하고 `oip/project`를 OIP에서 한 번 열어 둡니다.
2. `powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1` — OIP를 최소화해 시작하고 Play·OPC UA를 확인한 뒤 MES 서버(8085)와 웹(5173)을 시작합니다.
3. MES 작업지시에서 `가동 허가` → OIP(또는 웹 트윈)에서 시작 버튼을 누르면 공정이 돌고, OPC UA로 수량이 DB에 반영됩니다.

## 검증 범위와 남은 부분

- OIP 공정 시험 5종 통과(헤드리스 엔진, 브라우저판과 같은 코드).
- 웹 트윈: 허가 없는 시작 무시 → 허가 시 램프 점등 → 시작 버튼으로 가동 → 정지 버튼으로 정지, 티치펜던트 조그·저장·적용·시험 실행을 브라우저 자동화로 확인했습니다.
- 공개 사이트는 정적 호스팅이라 MES 서버·DB가 없습니다. 공개 사이트의 MES 기록(계획·LOT·출고)은 예시 데이터이고, 3D 공정과 PLC는 각 방문자의 브라우저에서 따로 돕니다. 웹 트윈의 실적을 DB에 저장하려면 MES 서버를 함께 배포해야 합니다(후속 작업).
- 검사는 규칙 기반 판정입니다. 영상 불량 판정과 원인 분류는 미적용입니다.
- 제품별 물리 ID를 출고 차량까지 보존하는 기능은 후속 작업입니다.

OIP 이름과 로고는 OIP 프로젝트의 것이며 이 저장소는 OIP와 제휴하지 않았습니다. 웹 트윈 라이선스 고지는 배포 사이트의 `/twin-licenses/`와 `docs/OIP-MIT-LICENSE.txt`에 있습니다.

> 이 저장소는 제조 공정 구현·검증을 보여주는 시연 환경입니다. 실제 설비를 제어하거나 품질 성능을 보증하는 운영 시스템은 아닙니다.
