import { useEffect, useState } from 'react'
import { can, needText, useSession } from './auth'
import { lightOf, LIGHT_KO, lower, modeKo, reloadEquipment, STATUS_KO, useEquipment, type Alarm, type Asset, type Fault } from './equipment'
import './Equipment.css'

// 설비 관리 · 예지보전: everyone may look; repair, confirm, preventive service and retraining are the 설비 관리자's.
// The MES does not repair anything. It records the stop (잠금), the repair (수리) and the sign-off (확인); the line only
// runs again after the sign-off.

const time = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—')
const minutes = (a: string | null, b: string | null) => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 60000 : null)
async function post(url: string, body?: unknown) {
  const r = await fetch(url, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const b = await r.json().catch(() => ({}))
  if (!r.ok) throw Error(b.detail || b.message || `HTTP ${r.status}`)
  return b
}

function Heading({ label, title, aside }: { label: string; title: string; aside?: string }) {
  return <div className="op-title"><div><small>{label}</small><h2>{title}</h2></div>{aside && <span>{aside}</span>}</div>
}

/** the machine being repaired: a padlock while locked out, a turning wrench while repaired, a tick when signed off */
function RepairPicture({ status }: { status: Fault['status'] }) {
  return <svg className={`eq-pic s-${status.toLowerCase()}`} viewBox="0 0 160 120" role="img" aria-label={STATUS_KO[status]}>
    <rect x="18" y="58" width="124" height="38" rx="6" className="eq-pic-body"/>
    <circle cx="50" cy="77" r="11" className="eq-pic-roll"/><circle cx="110" cy="77" r="11" className="eq-pic-roll"/>
    <rect x="30" y="100" width="100" height="6" rx="3" className="eq-pic-base"/>
    <g className="eq-pic-gear"><circle cx="80" cy="40" r="14"/>{[0, 45, 90, 135].map((d) => <rect key={d} x="77" y="20" width="6" height="40" rx="2" transform={`rotate(${d} 80 40)`}/>)}<circle cx="80" cy="40" r="6" className="eq-pic-hole"/></g>
    {status === 'LOCKED' && <g className="eq-pic-lock"><rect x="112" y="14" width="30" height="24" rx="4"/><path d="M118 14v-5a9 9 0 0 1 18 0v5" fill="none" strokeWidth="4"/></g>}
    {status === 'REPAIRING' && <g className="eq-pic-wrench"><path d="M126 6a12 12 0 0 0-11 16L96 41l6 6 19-19a12 12 0 0 0 16-11l-7 4-6-6 4-7a12 12 0 0 0-2-2z"/></g>}
    {status === 'CONFIRMED' && <path className="eq-pic-ok" d="M114 24l8 8 16-18" fill="none" strokeWidth="6"/>}
  </svg>
}

function OpenFault({ fault, asset, maint, onDone }: { fault: Fault; asset?: Asset; maint: boolean; onDone: (m: string, ok: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const act = async (what: 'repair' | 'confirm') => {
    setBusy(true)
    try {
      await post(`/api/equipment/faults/${fault.id}/${what}`)
      onDone(what === 'repair' ? '수리를 시작했습니다. 수리가 끝나면 확인을 눌러 주세요.' : '수리를 확인했습니다. 잠금이 풀리고 가동 중인 작업이면 라인이 다시 시작합니다.', true)
    } catch (e) { onDone(e instanceof Error ? e.message : String(e), false) } finally { setBusy(false); void reloadEquipment() }
  }
  const steps: [Fault['status'], string, string | null, string | null][] = [
    ['LOCKED', '잠금', fault.locked_at, fault.kind === 'PREVENTIVE' ? fault.note : '설비가 자동 정지'],
    ['REPAIRING', '수리', fault.repair_started_at, fault.repair_by],
    ['CONFIRMED', '확인 · 재가동', fault.confirmed_at, fault.confirmed_by],
  ]
  const at = steps.findIndex(([st]) => st === fault.status)
  return <section className={`card eq-fault s-${fault.status.toLowerCase()}`} aria-live="polite">
    <div className="eq-fault-main">
      <RepairPicture status={fault.status}/>
      <div className="eq-fault-text">
        <small>{fault.kind === 'BREAKDOWN' ? 'EQUIPMENT FAULT · LINE STOPPED' : 'PREVENTIVE MAINTENANCE · LINE STOPPED'}</small>
        <h2>{asset?.name ?? fault.asset_code} · {fault.kind === 'BREAKDOWN' ? `${modeKo(fault.mode_code)} 고장` : '예방 정비'}</h2>
        <p>고장 코드 {fault.fault_code} · {Math.round(fault.units)}개 생산 시점 · OIP 현장 설비와 웹 트윈이 함께 멈춰 있습니다.
          {fault.kind === 'BREAKDOWN' && (fault.alarm_lead_units != null ? ` 예지보전이 고장 ${Math.round(fault.alarm_lead_units)}개 전에 ${modeKo(fault.predicted_mode)} 경보를 냈습니다.` : ' 고장 전에 예지보전 경보가 없었습니다.')}</p>
      </div>
      <div className="eq-fault-actions">
        <button className="primary" disabled={!maint || busy || fault.status !== 'LOCKED'} title={maint ? undefined : needText('MAINTENANCE')} onClick={() => void act('repair')}>수리 시작</button>
        <button className="primary ok" disabled={!maint || busy || fault.status !== 'REPAIRING'} title={maint ? undefined : needText('MAINTENANCE')} onClick={() => void act('confirm')}>수리 확인 · 재가동</button>
        {!maint && <span className="perm-note">수리와 확인은 설비 관리자만 할 수 있습니다.</span>}
      </div>
    </div>
    <ol className="eq-steps">{steps.map(([st, label, when, who], i) => <li key={st} className={i < at ? 'done' : i === at ? 'now' : ''}><b>{i + 1}</b><div><strong>{label}</strong><span>{i <= at && when ? `${time(when)}${who ? ` · ${who}` : ''}` : '대기'}</span></div></li>)}</ol>
  </section>
}

function Spark({ values, low }: { values: number[]; low: number }) {
  if (values.length < 2) return <div className="eq-spark empty">건강도 추이 수집 중</div>
  const W = 200, H = 40, x = (i: number) => (i / (values.length - 1)) * W, y = (v: number) => H - (v / 100) * H
  return <svg className="eq-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="건강도 추이">
    <line x1="0" x2={W} y1={y(low)} y2={y(low)} className="eq-spark-low"/>
    <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none"/>
  </svg>
}

function AssetCard({ a, maint, busy, onPreventive }: { a: Asset; maint: boolean; busy: boolean; onPreventive: (code: string) => void }) {
  const light = lightOf(a)
  const [trend, setTrend] = useState<number[]>([])
  useEffect(() => {
    let gone = false
    const load = () => fetch(`/api/equipment/${a.code}/readings?limit=40`).then((r) => (r.ok ? r.json() : [])).then((rows: Record<string, unknown>[]) => {
      if (!gone) setTrend(rows.map((r) => Number(lower<{ health: number }>(r).health)).filter((v) => Number.isFinite(v)).reverse())
    }).catch(() => {})
    load()
    const t = window.setInterval(load, 10000)
    return () => { gone = true; window.clearInterval(t) }
  }, [a.code])
  const p = a.prediction
  const rul = p && p.mode !== 'NORMAL' && Number.isFinite(p.remaining) ? Math.max(0, Math.round(p.remaining)) : null
  return <article className={`eq-asset l-${light}`}>
    <div className="eq-asset-head"><i/><b>{a.name}</b><span>{LIGHT_KO[light]}</span></div>
    <div className="eq-health"><strong>{a.health ?? '—'}</strong><em>/100 건강도</em></div>
    <div className="eq-bar"><i style={{ width: `${a.health ?? 0}%` }}/></div>
    <Spark values={trend} low={60}/>
    <dl>
      <div><dt>AI 진단</dt><dd>{p ? (p.mode === 'NORMAL' ? `정상 ${Math.round((p.probs.NORMAL ?? 0) * 100)}%` : `${modeKo(p.mode)} ${Math.round(p.probability * 100)}%`) : '센서 6회 측정 후 진단'}</dd></div>
      <div><dt>남은 수명 예측</dt><dd>{rul != null ? `약 ${rul}개 생산` : p ? '이상 징후 없음' : '—'}</dd></div>
      <div><dt>교체 후 생산</dt><dd>{a.units}개</dd></div>
    </dl>
    <ul className="eq-sensors">{a.sensors.map((s) => { const v = a.latest?.[s.key]; const off = v != null && Math.abs(v - s.base) > 4 * s.noise
      return <li key={s.key} className={off ? 'off' : ''}><span>{s.name}</span><b>{v != null ? `${Number(v.toFixed(2))}` : '—'}<em>{s.unit}</em></b></li> })}</ul>
    {a.alarm && <p className={`eq-alarm ${a.alarm.level === 'ALERT' ? 'alert' : ''}`}>● {a.alarm.level === 'ALERT' ? '정비 권장' : '주의'} · {modeKo(a.alarm.mode_code)} ({time(a.alarm.raised_at)} 발령)</p>}
    <button disabled={!maint || busy || !!a.fault} title={maint ? undefined : needText('MAINTENANCE')} onClick={() => onPreventive(a.code)}>예방 정비 (라인 정지)</button>
  </article>
}

type Stats = { byMode: Record<string, unknown>[]; byAsset: Record<string, unknown>[]; downtime: Record<string, unknown>[]; alarms: Record<string, unknown>[] }

export default function EquipmentPage() {
  const o = useEquipment()
  const session = useSession()
  const maint = can('MAINTENANCE', session), admin = can('ADMIN', session)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)
  const [faults, setFaults] = useState<{ total: number; rows: Fault[] }>({ total: 0, rows: [] })
  const [pageNo, setPageNo] = useState(0)
  const [speed, setSpeed] = useState('')
  const openId = o?.openFault?.id ?? 0, openStatus = o?.openFault?.status ?? ''
  useEffect(() => {
    let gone = false
    const load = () => {
      fetch('/api/equipment/stats').then((r) => (r.ok ? r.json() : null)).then((s) => s && !gone && setStats(s)).catch(() => {})
      fetch(`/api/equipment/faults?limit=8&offset=${pageNo * 8}`).then((r) => (r.ok ? r.json() : null)).then((f) => f && !gone && setFaults({ total: f.total, rows: f.rows.map((x: Record<string, unknown>) => lower<Fault>(x)) })).catch(() => {})
    }
    load()
    const t = window.setInterval(load, 8000)
    return () => { gone = true; window.clearInterval(t) }
  }, [pageNo, openId, openStatus])
  const done = (m: string, ok: boolean) => setMsg([m, ok])
  const run = async (f: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await f(); done(ok, true) } catch (e) { done(e instanceof Error ? e.message : String(e), false) } finally { setBusy(false); void reloadEquipment() }
  }
  if (!o) return <section className="card eq-page"><p className="mes-muted">설비 데이터를 불러오는 중입니다.</p></section>
  const byMode = (stats?.byMode ?? []).map((r) => lower<{ mode_code: string; n: number; predicted: number }>(r)).sort((a, b) => Number(b.n) - Number(a.n))
  const breakdowns = byMode.reduce((s, r) => s + Number(r.n), 0), predicted = byMode.reduce((s, r) => s + Number(r.predicted), 0)
  const down = (stats?.downtime ?? []).map((r) => lower<{ kind: string; locked_at: string; confirmed_at: string }>(r))
  const mttr = (k: string) => { const m = down.filter((d) => d.kind === k).map((d) => minutes(d.locked_at, d.confirmed_at)!).filter((x) => x != null); return m.length ? m.reduce((a, b) => a + b, 0) / m.length : null }
  const prevented = (stats?.alarms ?? []).map((r) => lower<Alarm>(r)).filter((a) => a.outcome === 'PREVENTED').length
  const alarms = (stats?.alarms ?? []).map((r) => lower<Alarm>(r))
  const maxMode = Math.max(1, ...byMode.map((r) => Number(r.n)))
  const assetName = (c: string) => o.assets.find((a) => a.code === c)?.name ?? c
  const pages = Math.max(1, Math.ceil(faults.total / 8))
  const m = o.model
  return <div className="eq-page">
    {o.openFault
      ? <OpenFault fault={o.openFault} asset={o.assets.find((a) => a.code === o.openFault!.asset_code)} maint={maint} onDone={done}/>
      : <section className="card eq-clear"><b>●</b><div><strong>모든 설비 가동 가능</strong><span>잠금 중인 설비가 없습니다. 설비 고장이 나면 OIP 현장 설비와 웹 트윈이 자동으로 멈추고 이곳에 잠금 기록이 생깁니다.</span></div></section>}
    {msg && <p className={`mes-action-message ${msg[1] ? 'ok' : 'fail'}`} role={msg[1] ? 'status' : 'alert'}>{msg[0]}</p>}
    <section className="card">
      <Heading label="ASSET HEALTH" title="설비별 건강도 · 예지보전" aside="4개 생산마다 센서 측정 · 최근 6회로 진단"/>
      {!maint && <p className="perm-note">모든 사용자가 조회할 수 있습니다. 수리 · 확인 · 예방 정비는 설비 관리자(maint1)로 로그인해야 합니다.</p>}
      <div className="eq-assets">{o.assets.map((a) => <AssetCard key={a.code} a={a} maint={maint} busy={busy}
        onPreventive={(code) => { if (confirm(`${assetName(code)}을(를) 예방 정비합니다. 라인이 정지하고 정비 확인 후 재가동합니다. 계속할까요?`)) void run(() => post(`/api/equipment/${code}/preventive`), '예방 정비로 설비를 잠갔습니다. 수리 시작 → 수리 확인 순서로 진행하세요.') }}/>)}</div>
      <p className="fine">건강도 60 미만은 고장 징후가 있다는 뜻입니다. 주의는 AI가 고장 원인을 60% 이상 확신할 때, 정비 권장은 남은 수명이 {m.alertRul ?? 60}개 이하로 예측될 때 냅니다. 빨갛게 표시된 센서는 정상 범위(기준값 ± 잡음 4배)를 벗어난 값입니다.</p>
    </section>
    <div className="eq-two">
      <section className="card">
        <Heading label="FAILURE ANALYSIS" title="고장 원인 · 정비 지표" aside={`고장 ${breakdowns}건`}/>
        <div className="eq-kpis">
          <div><small>예지보전 사전 경보</small><strong>{breakdowns ? `${Math.round(predicted / breakdowns * 100)}%` : '—'}</strong><span>고장 {breakdowns}건 중 {predicted}건 미리 경보</span></div>
          <div><small>예방 정비로 막은 고장</small><strong>{prevented}<em>건</em></strong><span>경보 후 고장 전에 정비</span></div>
          <div><small>평균 복구 시간 (MTTR)</small><strong>{mttr('BREAKDOWN') != null ? mttr('BREAKDOWN')!.toFixed(1) : '—'}<em>분</em></strong><span>잠금 → 확인 · 고장</span></div>
        </div>
        {byMode.length ? <ul className="eq-modebars">{byMode.map((r) => <li key={r.mode_code}><span>{modeKo(r.mode_code)}</span><div><i style={{ width: `${Number(r.n) / maxMode * 100}%` }}/><i className="pred" style={{ width: `${Number(r.predicted) / maxMode * 100}%` }}/></div><b>{r.n}건</b></li>)}</ul>
          : <p className="mes-muted">아직 고장 기록이 없습니다. 생산이 이어지면 마모가 쌓여 고장이 나고, 여기에 원인별로 쌓입니다.</p>}
        <div className="qc-legend"><span><i style={{ background: '#d8755d' }}/>고장 건수</span><span><i style={{ background: '#255a8e' }}/>그중 미리 경보</span></div>
      </section>
      <section className="card">
        <Heading label="PREDICTIVE ALARMS" title="예지보전 경보 이력" aside="최근 20건"/>
        {alarms.length ? <ul className="eq-alarms">{alarms.slice(0, 8).map((a) => <li key={a.id} className={a.level === 'ALERT' ? 'alert' : ''}><b>{a.level === 'ALERT' ? '정비 권장' : '주의'}</b><span>{assetName(a.asset_code)} · {modeKo(a.mode_code)} {Math.round(a.probability * 100)}%{a.rul_at_raise != null ? ` · 남은 수명 ${Math.round(a.rul_at_raise)}개` : ''}</span><em>{time(a.raised_at)} · {a.cleared_at ? (a.outcome === 'PREVENTED' ? '예방 정비로 해소' : '고장 후 해소') : '진행 중'}</em></li>)}</ul>
          : <p className="mes-muted">발령된 경보가 없습니다.</p>}
      </section>
    </div>
    <section className="card">
      <Heading label="MAINTENANCE RECORD" title="설비 정비 기록 (잠금 → 수리 → 확인)" aside={`전체 ${faults.total}건`}/>
      <div className="op-table-wrap"><table><thead><tr><th>번호</th><th>설비</th><th>구분</th><th>원인</th><th>상태</th><th>잠금</th><th>수리</th><th>확인</th><th>정지 시간</th><th>사전 경보</th></tr></thead>
        <tbody>{faults.rows.length ? faults.rows.map((f) => { const d = minutes(f.locked_at, f.confirmed_at); return <tr key={f.id}>
          <td data-label="번호">#{f.id}</td><td data-label="설비">{assetName(f.asset_code)}</td><td data-label="구분">{f.kind === 'BREAKDOWN' ? '고장' : '예방 정비'}</td>
          <td data-label="원인">{modeKo(f.mode_code)}</td><td data-label="상태"><span className={`eq-chip s-${f.status.toLowerCase()}`}>{STATUS_KO[f.status]}</span></td>
          <td data-label="잠금">{time(f.locked_at)}</td><td data-label="수리">{time(f.repair_started_at)}{f.repair_by ? ` · ${f.repair_by}` : ''}</td><td data-label="확인">{time(f.confirmed_at)}{f.confirmed_by ? ` · ${f.confirmed_by}` : ''}</td>
          <td data-label="정지 시간">{d != null ? `${d.toFixed(1)}분` : '진행 중'}</td><td data-label="사전 경보">{f.kind === 'PREVENTIVE' ? '—' : f.alarm_lead_units != null ? `${Math.round(f.alarm_lead_units)}개 전` : '없음'}</td></tr> })
          : <tr><td colSpan={10} className="mes-muted">정비 기록이 없습니다.</td></tr>}</tbody></table></div>
      <div className="qc-pager"><button disabled={pageNo <= 0} onClick={() => setPageNo((p) => p - 1)}>이전</button><span>{pageNo + 1} / {pages}</span><button disabled={pageNo + 1 >= pages} onClick={() => setPageNo((p) => p + 1)}>다음</button></div>
    </section>
    <section className="card">
      <Heading label="PREDICTIVE MODEL" title="예지보전 AI 모델" aside={m.version ?? '학습 중'}/>
      <div className="eq-model">
        <div className="eq-model-facts">
          <div><small>학습 시각</small><b>{time(m.trainedAt)}</b><span>{m.reason ?? ''}</span></div>
          <div><small>학습 데이터</small><b>{m.samples?.toLocaleString() ?? '—'}개 측정</b><span>가상 수명 {m.syntheticLives ?? 0}회 + 이 라인 실제 고장 {m.lineLives ?? 0}회</span></div>
          <div><small>판정 기준</small><b>주의 ≥ {Math.round((m.warnProbability ?? 0.6) * 100)}% · 정비 권장 ≤ {m.alertRul ?? 60}개</b><span>원인 분류(로지스틱 회귀) + 남은 수명(릿지 회귀)</span></div>
        </div>
        <div className="op-table-wrap"><table><thead><tr><th>설비</th><th>원인 정확도</th><th>남은 수명 오차</th><th>오경보율</th><th>평균 선행 경보</th></tr></thead>
          <tbody>{Object.entries(m.holdout ?? {}).map(([code, h]) => <tr key={code}><td data-label="설비">{assetName(code)}</td><td data-label="원인 정확도">{(h.accuracy * 100).toFixed(1)}%</td><td data-label="남은 수명 오차">± {h.rulMae.toFixed(1)}개</td><td data-label="오경보율">{(h.falseAlarmRate * 100).toFixed(1)}%</td><td data-label="평균 선행 경보">{h.warnLead.toFixed(0)}개 전</td></tr>)}</tbody></table></div>
      </div>
      <div className="eq-model-actions">
        <button disabled={!maint || busy} title={maint ? undefined : needText('MAINTENANCE')} onClick={() => void run(() => post('/api/equipment/retrain'), '쌓인 정비 기록까지 포함해 모델을 다시 학습했습니다.')}>지금 다시 학습</button>
        <label className="eq-speed">시연 마모 배율 <b>×{o.speed}</b>
          <input type="number" min={1} max={50} placeholder={String(o.speed)} value={speed} disabled={!admin || busy} onChange={(e) => setSpeed(e.target.value)} title={admin ? undefined : needText('ADMIN')}/>
          <button disabled={!admin || busy || !speed} onClick={() => void run(() => post('/api/equipment/speed', { speed: Number(speed) }), `마모 배율을 ×${speed}로 바꿨습니다.`).then(() => setSpeed(''))}>적용</button></label>
      </div>
      <p className="fine">수명 검증은 학습에 쓰지 않은 가상 수명 8회로 합니다. 고장이 확인될 때마다 그 수명의 센서 기록이 정비 기록을 정답으로 학습 데이터에 더해지고, 모델이 자동으로 다시 학습합니다. 시연 배율은 실제 설비라면 수천 개 뒤에 날 마모를 몇 작업 안에 보여주려고 생산 1개를 여러 개만큼 마모시키는 값입니다.</p>
    </section>
  </div>
}
