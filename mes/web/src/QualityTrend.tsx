import { useEffect, useState } from 'react'
import { CAUSE_KO } from './AiInspection'

export type Bucket = { start: string; label: string; good: number; bad: number; inspected: number; byCause: Record<string, number> }
type Period = 'day' | 'week' | 'month' | 'year'
export type Mode = 'count' | 'pct'
const PERIODS: [Period, string][] = [['day', '일'], ['week', '주'], ['month', '월'], ['year', '년']]
export const CAUSES: [string, string][] = [['LID_MISSING', '#d8755d'], ['LID_MISALIGNED', '#e3a75a'], ['SCRATCH', '#5180af'], ['CRACK', '#7b6bb5'], ['CONTAMINATION', '#4f9e8f'], ['DENT', '#b5657f'], ['UNSURE', '#9aa5b1']]
export const GOOD = '#5180af', BAD = '#d8755d'
export type Part = { key: string; name: string; value: number; color: string }

/** stacked bars over time; in 'pct' mode each bar is 100% of its total */
export function Stack({ rows, mode, top, unit, width = 620 }: { rows: { label: string; parts: Part[] }[]; mode: Mode; top: (r: { parts: Part[] }) => string; unit: string; width?: number }) {
  const W = width, left = 40, right = 8, T = 24, H = 160
  const totals = rows.map((r) => r.parts.reduce((a, p) => a + p.value, 0))
  const max = mode === 'pct' ? 1 : Math.max(1, ...totals)
  // four equal integer steps that clear the tallest bar (1, 2, 5 × 10ⁿ per step)
  const nice = mode === 'pct' ? 1 : (() => { const raw = max / 4, m = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw)))); const step = [1, 2, 5, 10].map((k) => k * m).find((st) => st >= raw) ?? 10 * m; return Math.max(4, step * 4) })()
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * nice)
  const plotW = W - left - right, slot = plotW / rows.length, barW = Math.min(34, slot * 0.62)
  const every = Math.ceil(rows.length / 14)
  return <svg className="qc-plot" viewBox={`0 0 ${W} ${T + H + 26}`} role="img">
    {ticks.map((t) => { const y = T + H - (t / nice) * H; return <g key={t}><line x1={left} x2={W - right} y1={y} y2={y} stroke="#dde6f0"/><text x={left - 6} y={y + 4} textAnchor="end" className="qc-axis">{mode === 'pct' ? `${Math.round(t * 100)}%` : Math.round(t)}</text></g> })}
    {rows.map((r, i) => {
      const x = left + slot * i + (slot - barW) / 2, total = totals[i]
      let y = T + H
      return <g key={r.label}>
        {r.parts.map((p) => { if (!p.value) return null; const h = (mode === 'pct' ? p.value / total : p.value / nice) * H; y -= h
          return <rect key={p.key} x={x} y={y} width={barW} height={h} fill={p.color}><title>{`${r.label} · ${p.name} ${p.value}${unit} (${total ? Math.round(p.value / total * 1000) / 10 : 0}%)`}</title></rect> })}
        {total > 0 && <text x={x + barW / 2} y={(mode === 'pct' ? T : y) - 5} textAnchor="middle" className="qc-value">{top(r)}</text>}
        {i % every === 0 && <text x={x + barW / 2} y={T + H + 16} textAnchor="middle" className="qc-axis">{r.label}</text>}
      </g>
    })}
  </svg>
}

/** the period buckets from /api/quality/trend, refreshed every 15 s (the quality page and the home summary share it) */
export function useTrend(period: Period) {
  const [buckets, setBuckets] = useState<Bucket[] | null>(null)
  useEffect(() => {
    let gone = false
    const load = () => fetch(`/api/quality/trend?period=${period}`).then((r) => r.ok ? r.json() : Promise.reject()).then((d) => !gone && setBuckets(d.buckets)).catch(() => {})
    load()
    const t = window.setInterval(load, 15000)
    return () => { gone = true; window.clearInterval(t) }
  }, [period])
  return buckets
}
export const rate = (g: number, b: number) => (g + b ? `${(b / (g + b) * 100).toFixed(1)}%` : '—')
/** the two charts of a period, as drawn on the quality page */
export const goodBadRows = (list: Bucket[]) => list.map((b) => ({ label: b.label, parts: [{ key: 'good', name: '양품', value: b.good, color: GOOD }, { key: 'bad', name: '불량', value: b.bad, color: BAD }] }))
export const causeRows = (list: Bucket[]) => list.map((b) => ({ label: b.label, parts: CAUSES.map(([c, col]) => ({ key: c, name: CAUSE_KO[c], value: b.byCause[c] ?? 0, color: col })) }))

export default function QualityTrend() {
  const [period, setPeriod] = useState<Period>('day')
  const [mode, setMode] = useState<Mode>('count')
  const buckets = useTrend(period)
  const list = buckets ?? []
  const good = list.reduce((a, b) => a + b.good, 0), bad = list.reduce((a, b) => a + b.bad, 0)
  const causeTotal = list.reduce((a, b) => a + Object.values(b.byCause).reduce((x, y) => x + y, 0), 0)
  const causeSum = Object.fromEntries(CAUSES.map(([c]) => [c, list.reduce((a, b) => a + (b.byCause[c] ?? 0), 0)]))
  const span = PERIODS.find(([p]) => p === period)![1]
  return <section className="card qc-trend">
    <div className="op-title"><div><small>QUALITY TREND</small><h2>기간별 품질 추이</h2></div>
      <span>최근 {list.length}{span === '일' ? '일' : span === '주' ? '주' : span === '월' ? '개월' : '년'} · LOT 시작일·검사일 기준</span></div>
    <div className="qc-trend-controls">
      <div className="seg" role="group" aria-label="기간 단위">{PERIODS.map(([p, l]) => <button key={p} className={p === period ? 'on' : ''} onClick={() => setPeriod(p)}>{l}</button>)}</div>
      <div className="seg" role="group" aria-label="표시 방식"><button className={mode === 'count' ? 'on' : ''} onClick={() => setMode('count')}>수량</button><button className={mode === 'pct' ? 'on' : ''} onClick={() => setMode('pct')}>비율(%)</button></div>
    </div>
    <div className="qc-trend-grid">
      <div className="qc-trend-panel">
        <div className="qc-trend-head"><b>양품 · 불량</b><span>양품 {good}개 · 불량 {bad}개 · 불량률 {rate(good, bad)}</span></div>
        <div className="qc-legend"><span><i style={{ background: GOOD }}/>양품</span><span><i style={{ background: BAD }}/>불량</span><span className="qc-note">막대 위: 불량률</span></div>
        {buckets ? <Stack unit="개" mode={mode} rows={goodBadRows(list)} top={(r) => rate(r.parts[0].value, r.parts[1].value)}/> : <p className="mes-muted">불러오는 중</p>}
      </div>
      <div className="qc-trend-panel">
        <div className="qc-trend-head"><b>불량 원인</b><span>AI 판정 불량 {causeTotal}건{causeTotal ? ` · 최다 ${CAUSE_KO[Object.entries(causeSum).sort((a, b) => b[1] - a[1])[0][0]]}` : ''}</span></div>
        <div className="qc-legend">{CAUSES.map(([c, col]) => <span key={c}><i style={{ background: col }}/>{CAUSE_KO[c]}{causeTotal ? ` ${Math.round(causeSum[c] / causeTotal * 100)}%` : ''}</span>)}<span className="qc-note">막대 위: 불량 건수</span></div>
        {buckets ? <Stack unit="건" mode={mode} rows={causeRows(list)} top={(r) => String(r.parts.reduce((a, p) => a + p.value, 0))}/> : <p className="mes-muted">불러오는 중</p>}
      </div>
    </div>
    <p className="fine">양품·불량은 작업(LOT)이 시작된 날에, 불량 원인은 각 제품이 AI 검사를 받은 날에 셉니다. 막대에 마우스를 올리면 수량과 비율이 함께 보입니다. 불량 원인은 AI 판정을 도입한 뒤의 작업부터 집계됩니다.</p>
  </section>
}
