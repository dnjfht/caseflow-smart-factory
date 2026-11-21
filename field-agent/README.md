# 현장 PC 에이전트

배포된 MES(클라우드)와 이 PC의 **OIP 데스크톱**을 잇는 프로그램입니다. 실제 공장의 "현장 게이트웨이"와 같은 역할입니다.

```
웹 MES ─(HTTPS)─ MES 서버 + Postgres ─(HTTPS)─ 현장 에이전트 ─(로컬 MCP 5189)─ OIP 데스크톱 PLC
            └── 웹 트윈(브라우저 안의 같은 라인) ──┘
```

- **실행:** `start-field-pc.bat` 더블클릭. OIP를 최소화해 켜고, 프로젝트를 열어 Play한 뒤 에이전트를 띄웁니다. 필요: OIP 데스크톱(Agent connections 켜짐), Node.js 18 이상.
- **하는 일 (0.5초마다):** OIP의 PLC 태그를 MES로 보냄 → MES의 가동 허가·목표·자재 허가·재고 표시를 OIP에 씀 → 웹 트윈에서 누른 시작/정지를 OIP 버튼으로 누름 → 새 작업지시면 OIP 라인 초기화 → 티치펜던트에서 적용한 로봇 프로그램을 OIP 로봇에 반영.
- **연결 중에는** OIP 데스크톱이 기준 라인입니다. MES 실적은 OIP의 수량으로 기록되고, 웹 트윈은 같은 명령을 받아 함께 돕니다.
- 직접 실행: `node field-agent/caseflow-field-agent.mjs https://caseflow-mes-api.onrender.com`
