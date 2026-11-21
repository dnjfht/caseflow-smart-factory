#!/usr/bin/env node
// CaseFlow field agent: the shop-floor PC's link between OIP Desktop and the MES server.
//
//   node field-agent/caseflow-field-agent.mjs [MES server URL]      (default: the deployed server)
//
// Every half second it reads OIP Desktop's PLC tags through OIP's local agent door (http://127.0.0.1:5189/mcp,
// Settings > Agent connections), posts them to the MES (/api/twin/field-sync), and applies what comes back:
// the MES's writes (run permit, target, material permit and stock), start/stop presses made on the web twin,
// a line reset for a new work order, and the robot program taught on the MES's teach pendant.
// It keeps OIP's simulation playing. No dependencies: Node 18 or newer.

const SERVER = (process.argv[2] ?? process.env.CASEFLOW_MES ?? 'https://caseflow-mes-api.onrender.com').replace(/\/$/, '')
const OIP = process.env.OIP_MCP_URL ?? 'http://127.0.0.1:5189/mcp'
const ROBOT = 'AssemblyRobot'
const TAGS = ['M0', 'RunLatch', 'MesPermit', 'MesMaterialPermit', 'WorkOrderActive', 'TargetQuantity', 'MachineState', 'FaultCode',
  'LaunchedCount', 'RejectCount', 'ProducedCount', 'ShippedCount', 'AssemblyPhase', 'InspectionPhase', 'PackingPhase',
  'BodyConveyorRun', 'BodyStopper', 'LidStopper', 'RejectDiverter', 'RobotReady', 'PermitLamp', 'RunLamp', 'AlarmLamp',
  'BodyStockDisplay', 'LidStockDisplay']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const stamp = () => new Date().toLocaleTimeString('ko-KR')
const log = (...a) => console.log(`[${stamp()}]`, ...a)

let rpcId = 0
async function oip(name, args = {}) {
  const res = await fetch(OIP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`OIP ${name}: HTTP ${res.status}`)
  const body = await res.json()
  if (body.error || body.result?.isError) throw new Error(`OIP ${name}: ${JSON.stringify(body.error ?? body.result)}`.slice(0, 300))
  const text = body.result?.content?.find((c) => c.type === 'text')?.text
  return text ? JSON.parse(text) : body.result
}

async function mes(path, init) {
  const res = await fetch(SERVER + path, { ...init, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`MES ${path}: HTTP ${res.status}`)
  return res.json()
}

async function pulse(key) {
  await oip('set_tag', { name: key, value: true })
  await sleep(300)
  await oip('set_tag', { name: key, value: false })
}

async function applyRobotProgram() {
  const body = await mes('/api/twin/robot-program')
  const p = body.program
  if (!p?.waypoints || !p?.steps) return
  // the pendant's JOG pose and job are the browser's own; production uses the taught poses and job 1
  const keep = p.names.map((n, i) => (n === 'JOG' ? -1 : i)).filter((i) => i >= 0)
  const waypoints = keep.map((i) => p.waypoints[i])
  const names = keep.map((i) => p.names[i])
  const steps = p.steps.map((s) => [0, s[1], s[1] === 1 ? Math.max(0, keep.indexOf(s[2])) : s[2], s[3] ?? 0])
  await oip('update_part', { id: ROBOT, params: { waypoints, waypointNames: names.join('\n'), jobs: steps, jobNames: 'Assemble' } })
  log(`로봇 프로그램 적용: 웨이포인트 ${waypoints.length}개, ${steps.length}단계 (${body.savedAt ?? ''})`)
}

let lastReset = null
let lastProgram = null
let warned = ''
async function tick() {
  const state = await oip('get_tags', { names: TAGS })
  if (!state.running) {
    await oip('run')
    log('OIP 시뮬레이션이 멈춰 있어 Play를 눌렀습니다.')
    return
  }
  const tags = state.tags ?? {}
  const reply = await mes('/api/twin/field-sync', { method: 'POST', body: JSON.stringify({ session: 'field', tags }) })
  if (lastReset === null) lastReset = reply.resetSeq
  else if (reply.resetSeq !== lastReset) {
    lastReset = reply.resetSeq
    log('새 작업지시: OIP 라인을 초기화합니다 (Stop → Play).')
    await oip('stop')
    await sleep(600)
    await oip('run')
    return
  }
  for (const [k, v] of Object.entries(reply.writes ?? {})) {
    if (tags[k] !== v && (typeof v === 'boolean' || typeof v === 'number')) {
      await oip('set_tag', { name: k, value: v })
      if (k === 'MesPermit') log(v ? 'MES 가동 허가 수신 → OIP에 MesPermit=TRUE' : 'MES 허가 해제 수신 → OIP에 MesPermit=FALSE')
    }
  }
  for (const key of reply.pulses ?? []) {
    log(key === 'HmiStart' ? '웹 트윈에서 시작 → OIP 시작 버튼' : '웹 트윈에서 정지 → OIP 정지 버튼')
    await pulse(key)
  }
  if (lastProgram === null) lastProgram = reply.programSeq
  else if (reply.programSeq !== lastProgram) {
    lastProgram = reply.programSeq
    await applyRobotProgram().catch((e) => log('로봇 프로그램 적용 실패:', e.message))
  }
  warned = ''
}

log(`CaseFlow 현장 에이전트 시작 · MES ${SERVER} · OIP ${OIP}`)
log('MES 서버가 잠들어 있으면 첫 연결에 30초쯤 걸립니다.')
for (;;) {
  try {
    await tick()
  } catch (e) {
    const msg = String(e.message ?? e)
    if (msg !== warned) log('연결 대기:', msg.includes('5189') || msg.includes('ECONNREFUSED') ? 'OIP의 Agent connections(5189)가 꺼져 있거나 OIP가 실행 중이 아닙니다.' : msg)
    warned = msg
    await sleep(2000)
  }
  await sleep(500)
}
