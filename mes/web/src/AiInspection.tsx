import { useEffect, useState } from 'react'
import { apiUrl } from './apiBase'

export const CAUSE_KO: Record<string, string> = {
  OK: '정상', LID_MISSING: '뚜껑 누락', LID_MISALIGNED: '뚜껑 어긋남', SCRATCH: '스크래치', CRACK: '크랙',
  CONTAMINATION: '오염', DENT: '찍힘', UNSURE: '원인 불명(재검)',
}
const CAUSE_COLOR: Record<string, string> = {
  LID_MISSING: '#d8755d', LID_MISALIGNED: '#e3a75a', SCRATCH: '#5180af', CRACK: '#7b6bb5',
  CONTAMINATION: '#4f9e8f', DENT: '#b5657f', UNSURE: '#9aa5b1',
}
const CAUSES = ['LID_MISSING', 'LID_MISALIGNED', 'SCRATCH', 'CRACK', 'CONTAMINATION', 'DENT', 'UNSURE']
const ko = (c: string) => CAUSE_KO[c] ?? c
const pct = (x: number | null | undefined, d = 1) => (x == null || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(d)}%`)
type Row = Record<string, unknown>
const v = (r: Row, k: string) => r[k] ?? r[k.toUpperCase()]
type Summary = { total: number; rejected: number; unsure: number; avgLatencyMs: number | null; byCause: Record<string, number>; accuracy: number | null; escaped: number; defects: number; falseReject: number; goods: number; causeAccuracy: number | null }
type OrderMix = { orderId: number; orderCode: string; total: number; defects: number; byCause: Record<string, number> }
type Card = { version: string; threshold: { reject_p_defect: number; cause_min_confidence: number }; production: { defect_rate: number }; test: Record<string, number>; test_hard: Record<string, number> }
const PAGE = 10
const get = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))

/** 불량 원인별 비율: 도넛 */
function CausePie({ byCause }: { byCause: Record<string, number> }) {
  const entries = CAUSES.map((c) => [c, byCause[c] ?? 0] as const).filter(([, n]) => n > 0)
  const total = entries.reduce((a, [, n]) => a + n, 0)
  if (!total) return <p className="mes-muted">아직 불량이 없습니다.</p>
  let acc = 0
  const R = 70, r = 42, cx = 90, cy = 90
  const arc = (from: number, to: number) => {
    const a0 = from * 2 * Math.PI - Math.PI / 2, a1 = to * 2 * Math.PI - Math.PI / 2, big = to - from > 0.5 ? 1 : 0
    const p = (rad: number, a: number) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`
    return `M ${p(R, a0)} A ${R} ${R} 0 ${big} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${big} 0 ${p(r, a0)} Z`
  }
  return <div className="ai-pie">
    <svg viewBox="0 0 180 180" role="img" aria-label="불량 원인별 비율 원형 그래프">
      {entries.length === 1
        ? <circle cx={cx} cy={cy} r={(R + r) / 2} fill="none" stroke={CAUSE_COLOR[entries[0][0]]} strokeWidth={R - r}><title>{`${ko(entries[0][0])} ${total}건 (100%)`}</title></circle>
        : entries.map(([c, n]) => { const from = acc / total; acc += n; return <path key={c} d={arc(from, acc / total)} fill={CAUSE_COLOR[c]}><title>{`${ko(c)} ${n}건 (${pct(n / total)})`}</title></path> })}
      <text x={cx} y={cy - 2} textAnchor="middle" className="ai-pie-n">{total}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" className="ai-pie-l">불량 건수</text>
    </svg>
    <ul>{entries.map(([c, n]) => <li key={c}><i style={{ background: CAUSE_COLOR[c] }}/>{ko(c)}<b>{pct(n / total)}</b><span>{n}건</span></li>)}</ul>
  </div>
}

/** 작업지시별 불량 원인 구성: 100% 누적 막대 (위에 불량률) */
function OrderBars({ orders }: { orders: OrderMix[] }) {
  const list = [...orders].reverse()
  if (!list.length) return <p className="mes-muted">AI 판정 기록이 있는 작업이 없습니다.</p>
  const W = 620, left = 40, right = 10, top = 26, H = 170, plotW = W - left - right
  const x = (i: number) => left + plotW * (i + 0.5) / list.length
  const barW = Math.min(46, plotW / list.length * 0.55)
  return <svg className="qc-plot" viewBox={`0 0 ${W} ${top + H + 44}`} role="img" aria-label="작업지시별 불량 원인 구성 막대 그래프">
    {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={left} x2={W - right} y1={top + H - t * H} y2={top + H - t * H} stroke="#dde6f0"/><text x={left - 6} y={top + H - t * H + 4} textAnchor="end" className="qc-axis">{t * 100}%</text></g>)}
    {list.map((o, i) => {
      let y = top + H
      return <g key={o.orderId}>
        {o.defects === 0
          ? <rect x={x(i) - barW / 2} y={top + H - 2} width={barW} height={2} fill="#c9d6e3"/>
          : CAUSES.map((c) => { const n = o.byCause[c] ?? 0; if (!n) return null; const h = n / o.defects * H; y -= h; return <rect key={c} x={x(i) - barW / 2} y={y} width={barW} height={h} fill={CAUSE_COLOR[c]}><title>{`${o.orderCode} · ${ko(c)} ${n}건 (불량 중 ${pct(n / o.defects)})`}</title></rect> })}
        <text x={x(i)} y={top - 8} textAnchor="middle" className="qc-value">{pct(o.total ? o.defects / o.total : 0, 0)}</text>
        <text x={x(i)} y={top + H + 16} textAnchor="middle" className="qc-axis">{o.orderCode.replace(/^WO-/, '')}</text>
        <text x={x(i)} y={top + H + 30} textAnchor="middle" className="qc-axis">{o.defects}/{o.total}</text>
      </g>
    })}
  </svg>
}

export default function AiInspection() {
  const [card, setCard] = useState<Card | null>(null)
  const [ready, setReady] = useState<boolean | null>(null)
  const [orders, setOrders] = useState<OrderMix[]>([])
  const [scope, setScope] = useState<number | 'ALL'>('ALL')
  const [verdict, setVerdict] = useState<'ALL' | 'GOOD' | 'NG'>('ALL')
  const [page, setPage] = useState(1)
  const [sum, setSum] = useState<Summary | null>(null)
  const [log, setLog] = useState<{ total: number; rows: Row[] }>({ total: 0, rows: [] })
  const [open, setOpen] = useState<Row | null>(null)
  useEffect(() => {
    let gone = false
    const q = scope === 'ALL' ? '' : `orderId=${scope}`
    const load = () => {
      get('/api/ai/model').then((m) => { if (!gone) { setReady(m.ready); setCard(m.card) } }).catch(() => {})
      get('/api/ai/by-order?limit=8').then((m) => !gone && setOrders(m)).catch(() => {})
      get(`/api/ai/live?${q}`).then((m) => !gone && setSum(m)).catch(() => {})
      get(`/api/ai/inspections?limit=${PAGE}&offset=${(page - 1) * PAGE}&${q}${verdict === 'ALL' ? '' : `&verdict=${verdict}`}`).then((m) => !gone && setLog(m)).catch(() => {})
    }
    load()
    const t = window.setInterval(load, 4000)
    return () => { gone = true; window.clearInterval(t) }
  }, [scope, verdict, page])
  const pages = Math.max(1, Math.ceil(log.total / PAGE))
  const top = sum && Object.entries(sum.byCause ?? {}).filter(([c]) => c !== 'UNSURE').sort((a, b) => b[1] - a[1])[0]
  const scopeLabel = scope === 'ALL' ? '전체 작업' : orders.find((o) => o.orderId === scope)?.orderCode ?? `작업 ${scope}`
  const probs = (r: Row) => { try { return JSON.parse(String(v(r, 'probs'))) as Record<string, number> } catch { return {} } }
  return <>
    <section className="card ai-card">
      <div className="op-title"><div><small>VISION AI INSPECTION</small><h2>AI 외관 검사 현황</h2></div>
        <span>{ready == null ? '확인 중' : ready ? `모델 ${card?.version ?? ''} 가동` : '모델 없음'}</span></div>
      <div className="qc-controls">
        <select aria-label="조회 범위" value={String(scope)} onChange={(e) => { setScope(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value)); setPage(1) }}>
          <option value="ALL">전체 작업</option>
          {orders.map((o) => <option key={o.orderId} value={o.orderId}>{o.orderCode}</option>)}
        </select>
        <span>{scopeLabel} 기준 · 4초마다 갱신</span>
      </div>
      <div className="ai-kpis">
        <div><b>{sum?.total ?? 0}</b><span>검사 수</span></div>
        <div className={sum && sum.rejected > 0 ? 'bad' : ''}><b>{sum ? `${sum.rejected}` : '—'}<small> / {pct(sum && sum.total ? sum.rejected / sum.total : null)}</small></b><span>불량 · 불량률</span></div>
        <div><b>{top ? ko(top[0]) : '—'}</b><span>최다 불량 원인{top && sum?.rejected ? ` (${pct(top[1] / sum.rejected, 0)})` : ''}</span></div>
        <div><b>{sum?.byCause?.UNSURE ?? 0}</b><span>원인 불명 · 재검 대상</span></div>
        <div><b>{sum?.avgLatencyMs == null ? '—' : `${sum.avgLatencyMs.toFixed(0)} ms`}</b><span>평균 판정 시간</span></div>
      </div>
    </section>
    <section className="qc-grid ai-charts">
      <div className="card qc-card"><div className="qc-heading"><div><small>DEFECT CAUSES</small><h2>불량 원인별 비율</h2></div><span>{scopeLabel}</span></div>{sum ? <CausePie byCause={sum.byCause ?? {}}/> : <p className="mes-muted">불러오는 중</p>}</div>
      <div className="card qc-card"><div className="qc-heading"><div><small>CAUSE MIX BY ORDER</small><h2>작업지시별 불량 원인 구성</h2></div><span>최근 {orders.length}건</span></div>
        <div className="qc-legend ai-legend">{CAUSES.map((c) => <span key={c}><i style={{ background: CAUSE_COLOR[c] }}/>{ko(c)}</span>)}</div>
        <OrderBars orders={orders}/>
        <p className="fine">막대 위 숫자는 그 작업의 불량률, 아래는 불량/검사 수입니다. 막대는 불량 안에서 원인이 차지하는 비율입니다.</p></div>
    </section>
    <section className="card">
      <div className="op-title"><div><small>INSPECTION LOG</small><h2>검사 이력</h2></div><span>{scopeLabel} · {log.total}건</span></div>
      <div className="qc-controls">
        <select aria-label="판정 필터" value={verdict} onChange={(e) => { setVerdict(e.target.value as 'ALL' | 'GOOD' | 'NG'); setPage(1) }}>
          <option value="ALL">전체 판정</option><option value="NG">불량만</option><option value="GOOD">양품만</option>
        </select>
        <span>행을 누르면 검사 이미지와 판정 근거를 봅니다</span>
      </div>
      <div className="op-table-wrap"><table className="ai-log"><thead><tr><th>작업번호</th><th>순번</th><th>검사 시각</th><th>판정</th><th>불량 원인</th><th>신뢰도</th></tr></thead>
        <tbody>{log.rows.map((r) => { const good = Boolean(v(r, 'verdict_good')); return <tr key={String(v(r, 'id'))} onClick={() => setOpen(r)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}>
          <td data-label="작업번호">{String(v(r, 'order_code') ?? '—')}</td><td data-label="순번">{String(v(r, 'seq'))}</td>
          <td data-label="검사 시각">{new Date(String(v(r, 'inspected_at'))).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
          <td data-label="판정"><em className={good ? 'ok' : 'ng'}>{good ? '양품' : '불량'}</em></td>
          <td data-label="불량 원인">{good ? '—' : <><i className="dot" style={{ background: CAUSE_COLOR[String(v(r, 'cause'))] }}/>{ko(String(v(r, 'cause')))}</>}</td>
          <td data-label="신뢰도">{pct(Number(v(r, 'confidence')), 0)}</td></tr> })}
          {log.rows.length === 0 && <tr><td colSpan={6} className="mes-muted">검사 이력이 없습니다. 작업을 시작하면 검사 셀에 도착하는 순서대로 기록됩니다.</td></tr>}
        </tbody></table></div>
      <div className="qc-pager"><button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</button><span>{Math.min(page, pages)} / {pages}</span><button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>다음</button></div>
      <details className="ai-model">
        <summary>AI 모델 정보 · 판정 기준</summary>
        {card && <div className="ai-model-grid">
          <div><b>판정 기준</b><p>불량 확률 ≥ {card.threshold.reject_p_defect.toFixed(2)} 이면 불량. 불량 중 원인 확신이 {pct(card.threshold.cause_min_confidence, 0)} 미만이면 '원인 불명(재검)'.</p></div>
          <div><b>시험 성능 (학습에 쓰지 않은 1,050장)</b><p>정확도 {pct(card.test.accuracy)} · 불량 유출 {pct(card.test.defect_escape)} · 과검출 {pct(card.test.false_reject)} · 열악 조건 정확도 {pct(card.test_hard.accuracy)}</p></div>
          <div><b>라인 판정 대조 (시뮬레이션 정답 기준)</b><p>{sum && sum.total ? <>정확도 {pct(sum.accuracy)} · 불량 유출 {sum.escaped}/{sum.defects} · 과검출 {sum.falseReject}/{sum.goods} · 원인 정확도 {pct(sum.causeAccuracy)}</> : '아직 판정이 없습니다.'}</p></div>
          <div><b>검사 이미지</b><p>학습에 쓰지 않은 운영 이미지 풀에서 무작위(불량 사진 {pct(card.production.defect_rate, 0)}). 실제 라인에서는 이 자리가 검사 카메라 사진입니다.</p></div>
        </div>}
      </details>
    </section>
    {open && <div className="ai-modal" role="dialog" aria-modal="true" aria-label="검사 상세" onClick={() => setOpen(null)}>
      <div onClick={(e) => e.stopPropagation()}>
        <header><b>{String(v(open, 'order_code') ?? '')} · #{String(v(open, 'seq'))}</b><button onClick={() => setOpen(null)} aria-label="닫기">×</button></header>
        <div className="ai-modal-body">
          <img src={apiUrl(`/api/ai/image/${String(v(open, 'image'))}`)} alt="검사 이미지"/>
          <div>
            <p className="ai-verdict"><em className={v(open, 'verdict_good') ? 'ok' : 'ng'}>{v(open, 'verdict_good') ? '양품' : `불량 · ${ko(String(v(open, 'cause')))}`}</em></p>
            <p className="fine">불량 확률 {pct(Number(v(open, 'p_defect')))} (기준 {Number(v(open, 'threshold')).toFixed(2)}) · 판정 {String(v(open, 'latency_ms'))} ms · 모델 {String(v(open, 'model_version'))}</p>
            <ul className="ai-probs">{Object.entries(probs(open)).sort((a, b) => b[1] - a[1]).map(([c, p]) => <li key={c}><span>{ko(c)}</span><i><s style={{ width: `${Math.max(1, p * 100)}%`, background: c === 'OK' ? '#5180af' : CAUSE_COLOR[c] }}/></i><b>{pct(p)}</b></li>)}</ul>
            <p className="fine">시뮬레이션 정답: {ko(String(v(open, 'true_label')))}</p>
          </div>
        </div>
      </div>
    </div>}
  </>
}
