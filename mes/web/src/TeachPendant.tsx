import { useEffect, useRef, useState } from 'react'
import { TwinSlot } from './TwinHost'
import { isStaticSite, twin, useTwinLink, useTwinTags } from './twin'
import './TeachPendant.css'

// A teach pendant for the line's assembly robot, laid out like a cobot app: jog each joint, store poses as
// waypoints, arrange the job's steps, try the job by hand, then apply it to production. The robot is the twin's
// six-axis arm; its job 1 ("Assemble") is what the PLC runs on every case (RobotCommand = 1, RobotStart pulse).

const MOVE = 1, VACUUM = 2, WAIT = 3, WAIT_FOR = 4, SET_OUT = 5
const OP_LABEL: Record<number, string> = { [MOVE]: '이동', [VACUUM]: '흡착', [WAIT]: '대기', [WAIT_FOR]: '입력 대기', [SET_OUT]: '신호 출력' }
const POSE_KO: Record<string, string> = { Home: '홈', 'Pick High': '픽 상부', Pick: '픽', 'Place High': '플레이스 상부', Place: '플레이스' }
const JOG_NAME = 'JOG'
type Program = { waypoints: number[][]; names: string[]; steps: number[][] }
const round = (v: number) => Math.round(v * 10) / 10

export default function TeachPendant() {
  const { ready, tags } = useTwinTags(300)
  const link = useTwinLink()
  const viewer = link.mode === 'viewer'
  const running = tags.M0 === true || (viewer && link.serverTags.M0 === true)
  const [joints, setJoints] = useState<number[] | null>(null)
  const [inc, setInc] = useState(5)
  const [prog, setProg] = useState<Program | null>(null)
  const original = useRef<Program | null>(null)
  const [sel, setSel] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const limits = twin()?.robot.limits ?? [[-180, 180], [-135, 135], [-160, 160], [-180, 180], [-120, 120], [-360, 360]]

  // live joint readout, and the program as the robot holds it
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = twin()
      if (!t) return
      const j = t.robot.joints()
      if (j) setJoints(j)
      setProg(cur => {
        if (cur) return cur
        const p = t.robot.program()
        const loaded = { waypoints: p.waypoints, names: p.names, steps: p.jobs.filter(r => r[0] === 0) }
        original.current = structuredClone(loaded)
        return loaded
      })
    }, 200)
    return () => window.clearInterval(id)
  }, [])

  const locked = !ready || running || busy || viewer
  async function act(label: string, fn: () => Promise<string | null> | string | null) {
    setBusy(true)
    try { const err = await fn(); setMsg(err ?? label) } finally { setBusy(false) }
  }
  const moveTo = (row: number[]) => { setMsg('이동 중… (로봇이 이전 동작 중이면 끝난 뒤 이동)'); return act('이동 완료', async () => twin()?.robot.jogTo(row) ?? '시뮬레이터 준비 중입니다.') }
  function jog(axis: number, dir: number) {
    // a jog is relative to where the arm actually is, as on a pendant
    const base = twin()?.robot.joints() ?? joints
    if (!base) return
    const [lo, hi] = limits[axis]
    const row = base.map((v, i) => i === axis ? Math.min(hi, Math.max(lo, round(v + dir * inc))) : v)
    if (row[axis] === base[axis]) { setMsg(`J${axis + 1} 관절 한계(${lo}° ~ ${hi}°)입니다.`); return }
    void moveTo(row)
  }
  function edit(next: Program) { setProg(next); setDirty(true) }
  function savePose(asNew: boolean) {
    if (!prog || !joints) return
    const wp = prog.waypoints.map(r => [...r]), names = [...prog.names]
    if (asNew) { wp.push([...joints]); names[wp.length - 1] = `P${wp.length}`; setSel(wp.length - 1) }
    else wp[sel] = [...joints]
    edit({ ...prog, waypoints: wp, names })
    setMsg(asNew ? '현재 자세를 새 지점으로 저장했습니다.' : `현재 자세를 '${poseName(prog.names[sel])}'에 저장했습니다.`)
  }
  function setStep(i: number, row: number[]) { if (prog) edit({ ...prog, steps: prog.steps.map((r, k) => k === i ? row : r) }) }
  function moveStep(i: number, d: number) {
    if (!prog) return
    const s = [...prog.steps]; const j = i + d
    if (j < 0 || j >= s.length) return
    ;[s[i], s[j]] = [s[j], s[i]]; edit({ ...prog, steps: s })
  }
  function addStep(op: number) {
    if (!prog) return
    const row = op === MOVE ? [0, MOVE, sel, 0] : op === VACUUM ? [0, VACUUM, 1, 0] : op === WAIT ? [0, WAIT, 0.5, 0] : [0, SET_OUT, 0, 1]
    edit({ ...prog, steps: [...prog.steps, row] })
  }
  const apply = () => act('로봇 프로그램을 공정에 적용했습니다. 다음 조립부터 이 순서로 동작합니다.', () => {
    if (!prog) return '프로그램을 불러오는 중입니다.'
    const t = twin()
    if (!t) return '시뮬레이터 준비 중입니다.'
    const err = t.robot.apply(prog)
    if (err) return err
    setDirty(false)
    // kept in the MES database, so the next session (anyone's) starts from this program
    if (!isStaticSite) void fetch('/api/twin/robot-program', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...prog, savedBy: 'MES 티치펜던트' }) })
    return null
  })
  const testRun = () => act('조립 작업 1회 시험 실행을 마쳤습니다.', () => twin()?.robot.runJob(1) ?? '시뮬레이터 준비 중입니다.')
  function restore() { if (original.current) { setProg(structuredClone(original.current)); setDirty(true); setMsg('원래 프로그램을 불러왔습니다. 적용을 눌러야 공정에 반영됩니다.') } }

  const poseName = (n?: string) => (n && POSE_KO[n]) || n || '-'
  const visible = prog ? prog.names.map((n, i) => ({ n, i })).filter(x => x.n !== JOG_NAME && x.i < prog.waypoints.length) : []

  return <section className="card pendant">
    <div className="op-title"><div><small>COBOT TEACH PENDANT</small><h2>협동로봇 티치펜던트</h2></div>
      <span className={running ? 'mode auto' : 'mode manual'}>{running ? 'AUTO · 공정 가동 중 (수동 잠금)' : 'MANUAL · 수동 조작 가능'}</span></div>
    <div className="pendant-layout">
      <TwinSlot view="robot" className="pendant-view" />
      <div className="pendant-side">
        <div className="pendant-block">
          <div className="block-head"><b>관절 조그</b><div className="inc">{[1, 5, 10].map(v => <button key={v} className={inc === v ? 'on' : ''} onClick={() => setInc(v)}>{v}°</button>)}</div></div>
          {[0, 1, 2, 3, 4, 5].map(a => {
            const v = joints?.[a] ?? 0, [lo, hi] = limits[a]
            return <div className="jog-row" key={a}>
              <span className="axis">J{a + 1}</span>
              <button disabled={locked} onClick={() => jog(a, -1)} aria-label={`J${a + 1} 감소`}>−</button>
              <div className="jog-gauge"><i style={{ left: `${((v - lo) / (hi - lo)) * 100}%` }} /><strong>{v.toFixed(1)}°</strong></div>
              <button disabled={locked} onClick={() => jog(a, 1)} aria-label={`J${a + 1} 증가`}>+</button>
            </div>
          })}
        </div>
        <div className="pendant-block">
          <div className="block-head"><b>웨이포인트</b><small>관절각 6개 = 한 자세</small></div>
          <div className="wp-list">{visible.map(({ n, i }) => <button key={i} className={sel === i ? 'on' : ''} onClick={() => setSel(i)}>{poseName(n)}<small>{prog!.waypoints[i].map(x => Math.round(x)).join(' / ')}</small></button>)}</div>
          <div className="pendant-buttons">
            <button disabled={locked || !prog} onClick={() => prog && moveTo(prog.waypoints[sel])}>선택 지점으로 이동</button>
            <button disabled={locked || !joints} onClick={() => savePose(false)}>현재 자세 저장</button>
            <button disabled={locked || !joints} onClick={() => savePose(true)}>새 지점 추가</button>
          </div>
        </div>
      </div>
    </div>
    <div className="pendant-block program">
      <div className="block-head"><b>조립 작업 순서 (Job 1)</b><small>PLC가 케이스마다 실행 · {prog?.steps.length ?? 0}단계</small></div>
      <ol className="steps">{prog?.steps.map((r, i) => <li key={i}>
        <span className="no">{i + 1}</span>
        <span className={`op op${r[1]}`}>{OP_LABEL[r[1]] ?? r[1]}</span>
        <span className="arg">{r[1] === MOVE ? <select disabled={locked} value={r[2]} onChange={e => setStep(i, [0, MOVE, Number(e.target.value), r[3]])}>{visible.map(({ n, i: k }) => <option key={k} value={k}>{poseName(n)}</option>)}</select>
          : r[1] === VACUUM ? <select disabled={locked} value={r[2]} onChange={e => setStep(i, [0, VACUUM, Number(e.target.value), 0])}><option value={1}>ON (잡기)</option><option value={0}>OFF (놓기)</option></select>
          : r[1] === WAIT ? <label><input disabled={locked} type="number" min={0} max={10} step={0.1} value={r[2]} onChange={e => setStep(i, [0, WAIT, Math.max(0, Number(e.target.value)), 0])} /> 초</label>
          : r[1] === SET_OUT ? <select disabled={locked} value={r[3]} onChange={e => setStep(i, [0, SET_OUT, r[2], Number(e.target.value)])}><option value={1}>완료 신호 ON</option><option value={0}>완료 신호 OFF</option></select>
          : <em>입력 {r[2] + 1} {r[3] ? 'ON' : 'OFF'}</em>}</span>
        {r[1] !== MOVE ? <span /> : <label className="blend"><input disabled={locked} type="checkbox" checked={r[3] === 1} onChange={e => setStep(i, [0, MOVE, r[2], e.target.checked ? 1 : 0])} />경유</label>}
        <span className="row-tools"><button disabled={locked || i === 0} onClick={() => moveStep(i, -1)}>↑</button><button disabled={locked || i === prog.steps.length - 1} onClick={() => moveStep(i, 1)}>↓</button><button disabled={locked || prog.steps.length <= 1} onClick={() => edit({ ...prog, steps: prog.steps.filter((_, k) => k !== i) })}>삭제</button></span>
      </li>)}</ol>
      <div className="add-steps"><span>단계 추가</span>{[MOVE, VACUUM, WAIT, SET_OUT].map(op => <button key={op} disabled={locked} onClick={() => addStep(op)}>+ {OP_LABEL[op]}</button>)}</div>
      <div className="pendant-actions">
        <button className="primary" disabled={locked || !dirty} onClick={apply}>공정에 적용</button>
        <button disabled={locked || dirty} onClick={testRun} title={dirty ? '먼저 공정에 적용하세요' : ''}>작업 1회 시험 실행</button>
        <button disabled={locked} onClick={restore}>원래 프로그램 불러오기</button>
        {dirty && <em>적용하지 않은 변경이 있습니다</em>}
      </div>
    </div>
    {viewer && <p className="op-message">{link.message}</p>}
    {msg && <p className="op-message" role="status">{msg}</p>}
    <p className="fine">공정이 가동 중이면 안전을 위해 수동 조작이 잠깁니다(현장 정지 후 사용). 관절 한계를 넘는 값은 이동하지 않습니다. 적용한 순서는 PLC가 다음 조립부터 실행합니다.</p>
  </section>
}
