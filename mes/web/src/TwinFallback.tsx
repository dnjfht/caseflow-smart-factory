import { useEffect, useState } from 'react'
import { twin, useTwinLink, useTwinTags } from './twin'

// The line in 2D, for a browser that cannot draw 3D: the same running PLC (the twin's simulation runs on the CPU)
// shown as a plan of the stations, with the assembly robot's arm drawn side-on from its live joint angles.

const C = { belt: '#3c4f55', beltOn: '#1b9876', station: '#ffffff', stationOn: '#e6f7f0', edge: '#c9d8d3', text: '#1c3e40', sub: '#6d8580', robot: '#e2772c' }

function Arm({ joints, x, y, s }: { joints: number[]; x: number; y: number; s: number }) {
  // side view: J2 shoulder, J3 elbow, J5 wrist (degrees), lengths in arbitrary units
  const rad = (d: number) => (d * Math.PI) / 180
  const L = [42, 38, 16].map((l) => l * s)
  let a = rad(-90 + (joints[1] ?? 0))
  const p0 = [x, y]
  const p1 = [p0[0] + L[0] * Math.cos(a), p0[1] + L[0] * Math.sin(a)]
  a += rad(joints[2] ?? 0)
  const p2 = [p1[0] + L[1] * Math.cos(a), p1[1] + L[1] * Math.sin(a)]
  a += rad(joints[4] ?? 0)
  const p3 = [p2[0] + L[2] * Math.cos(a), p2[1] + L[2] * Math.sin(a)]
  const pts = [p0, p1, p2, p3].map((p) => p.join(',')).join(' ')
  return <g>
    <rect x={x - 14 * s} y={y} width={28 * s} height={10 * s} rx={3} fill="#5b4636" />
    <polyline points={pts} fill="none" stroke={C.robot} strokeWidth={9 * s} strokeLinecap="round" strokeLinejoin="round" />
    {[p0, p1, p2].map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4.5 * s} fill="#ffd8b8" stroke="#a84f17" strokeWidth={1.5} />)}
    <rect x={p3[0] - 7 * s} y={p3[1] - 2 * s} width={14 * s} height={5 * s} fill="#2b3a40" />
  </g>
}

export default function TwinFallback({ view }: { view: 'overview' | 'robot' | 'shipping' }) {
  const { tags: local } = useTwinTags(300)
  const link = useTwinLink()
  const tags = link.mode === 'viewer' ? link.serverTags : local
  const [joints, setJoints] = useState<number[]>([0, -45, 90, 25, 75, 0])
  useEffect(() => {
    const id = window.setInterval(() => { const j = twin()?.robot.joints(); if (j) setJoints(j) }, 120)
    return () => window.clearInterval(id)
  }, [])
  const on = (k: string) => tags[k] === true
  const n = (k: string) => Number(tags[k] ?? 0)
  const run = on('M0')

  if (view === 'robot') {
    return <svg viewBox="0 0 400 260" role="img" aria-label="조립 로봇 관절 자세 (2D)">
      <rect x="0" y="210" width="400" height="50" fill="#dfe7e4" />
      <Arm joints={joints} x={200} y={200} s={1.9} />
      <text x="16" y="26" fill={C.text} fontSize="14" fontWeight="700">조립 로봇 · 측면도 (실시간 관절각)</text>
      <text x="16" y="46" fill={C.sub} fontSize="11">{joints.map((v, i) => `J${i + 1} ${v.toFixed(0)}°`).join('  ')}</text>
      <text x="16" y="246" fill={C.sub} fontSize="11">{n('AssemblyPhase') === 1 ? '조립 작업 중' : on('RobotReady') ? '대기 (다음 명령 가능)' : '동작 중'}</text>
    </svg>
  }

  const stations: [string, number, boolean][] = [
    ['본체·뚜껑 공급', 60, run && n('AssemblyPhase') === 0],
    ['로봇 조립', 250, n('AssemblyPhase') === 1],
    ['검사', 440, n('InspectionPhase') === 1],
    ['포장', 630, n('PackingPhase') === 1],
    ['출하', 820, run && on('BodyConveyorRun')],
  ]
  return <svg viewBox="0 0 960 330" role="img" aria-label="케이스 조립 라인 2D 공정 화면">
    <text x="24" y="34" fill={C.text} fontSize="17" fontWeight="800">케이스 조립 라인 · 2D 공정 화면</text>
    <text x="24" y="56" fill={C.sub} fontSize="12">PLC 상태 {n('MachineState')} · {run ? '가동 중' : on('MesPermit') ? 'MES 허가됨, 시작 대기' : 'MES 허가 없음'}</text>
    <rect x="40" y="168" width="880" height="22" rx="6" fill={run ? C.beltOn : C.belt} opacity={run ? 0.85 : 0.6} />
    {run && Array.from({ length: 22 }, (_, i) => <rect key={i} x={50 + i * 40} y="174" width="18" height="10" rx="2" fill="#ffffff55">
      <animate attributeName="x" from={50 + i * 40} to={90 + i * 40} dur="0.9s" repeatCount="indefinite" />
    </rect>)}
    <path d="M440 190 L440 270" stroke={on('RejectDiverter') ? '#e2574a' : C.belt} strokeWidth="18" opacity="0.7" />
    <text x="452" y="268" fill={C.sub} fontSize="11">불량 배출 {n('RejectCount')}</text>
    {stations.map(([label, x, active]) => <g key={label}>
      <rect x={x} y="88" width="140" height="64" rx="10" fill={active ? C.stationOn : C.station} stroke={active ? C.beltOn : C.edge} strokeWidth={active ? 2.5 : 1.2} />
      <text x={x + 70} y="117" textAnchor="middle" fill={C.text} fontSize="14" fontWeight="700">{label}</text>
      <text x={x + 70} y="137" textAnchor="middle" fill={active ? C.beltOn : C.sub} fontSize="11">{active ? '진행 중' : '대기'}</text>
    </g>)}
    <Arm joints={joints} x={320} y={166} s={0.75} />
    {[['목표', 'TargetQuantity'], ['투입', 'LaunchedCount'], ['불량', 'RejectCount'], ['포장', 'ProducedCount'], ['출하', 'ShippedCount']].map(([l, k], i) =>
      <g key={k}><rect x={560 + i * 76} y="226" width="68" height="52" rx="8" fill="#fff" stroke={C.edge} />
        <text x={594 + i * 76} y="246" textAnchor="middle" fill={C.sub} fontSize="11">{l}</text>
        <text x={594 + i * 76} y="268" textAnchor="middle" fill={C.text} fontSize="17" fontWeight="800">{n(k)}</text></g>)}
  </svg>
}
