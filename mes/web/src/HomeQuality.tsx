import type { Data, Row } from './App'
import { CAUSE_KO } from './AiInspection'
import { lightOf, LIGHT_KO, modeKo, STATUS_KO, useEquipment } from './equipment'
import './Equipment.css'
import { BAD, CAUSES, causeRows, GOOD, goodBadRows, rate, Stack, useTrend } from './QualityTrend'

// 운영 현황(홈)의 요약: the quality page's own charts, cut to the last 7 days, plus today's figures and the equipment
// lights. Each card links to the page with the detail.
const num = (r: Row | null, k: string) => (r ? Number(r[k.toUpperCase()] ?? r[k.toLowerCase()] ?? 0) : 0)
const str = (r: Row | null, k: string) => (r ? String(r[k.toUpperCase()] ?? r[k.toLowerCase()] ?? '') : '')

export default function HomeQuality({ data, order }: { data: Data; order: Row | null }) {
  const buckets = useTrend('day')
  const eq = useEquipment()
  const week = (buckets ?? []).slice(-7)
  const today = week[week.length - 1]
  const tGood = today?.good ?? 0, tBad = today?.bad ?? 0
  const before = week.slice(0, -1), bGood = before.reduce((a, b) => a + b.good, 0), bBad = before.reduce((a, b) => a + b.bad, 0)
  const tRate = tGood + tBad ? tBad / (tGood + tBad) : null, bRate = bGood + bBad ? bBad / (bGood + bBad) : null
  const diff = tRate != null && bRate != null ? (tRate - bRate) * 100 : null
  const running = !!order
  const target = num(order, 'TARGET_QTY'), exit = running ? data.plc.lineExit : 0
  const liveRate = running && data.plc.packed + data.plc.rejected ? data.plc.rejected / (data.plc.packed + data.plc.rejected) : null
  const wGood = week.reduce((a, b) => a + b.good, 0), wBad = week.reduce((a, b) => a + b.bad, 0)
  const causeSum = CAUSES.map(([c, col]) => [c, col, week.reduce((a, b) => a + (b.byCause[c] ?? 0), 0)] as const).filter(([, , n]) => n > 0).sort((a, b) => b[2] - a[2])
  const causeTotal = causeSum.reduce((a, [, , n]) => a + n, 0)
  const top3 = causeSum.slice(0, 3)
  const assets = eq?.assets ?? []
  const fault = eq?.openFault ?? null
  return <>
    <section className="card home-today" aria-label="오늘 생산 · 품질">
      <div className="op-title"><div><small>TODAY</small><h2>오늘 생산 · 품질</h2></div><a className="mes-link" href="#quality">품질 분석 →</a></div>
      <div className="home-today-grid">
        <div><small>오늘 양품</small><strong>{tGood}<em>개</em></strong><span>오늘 시작한 작업 기준</span></div>
        <div><small>오늘 불량</small><strong className="neg">{tBad}<em>개</em></strong><span>AI 검사 불량 분류</span></div>
        <div><small>오늘 불량률</small><strong>{rate(tGood, tBad)}</strong>
          <span className={diff == null ? '' : diff > 0.5 ? 'up' : diff < -0.5 ? 'down' : ''}>{diff == null ? '지난 6일 비교 자료 없음' : `지난 6일 평균 ${(bRate! * 100).toFixed(1)}% 대비 ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%p`}</span></div>
        <div className="home-progress"><small>현재 작업 진척</small>
          {running ? <><strong>{exit}<em> / {target}개</em></strong><div className="bar"><i style={{ width: `${Math.min(100, exit / Math.max(1, target) * 100)}%` }}/></div>
            <span>{str(order, 'ORDER_CODE')} · 실시간 불량률 {liveRate == null ? '—' : `${(liveRate * 100).toFixed(1)}%`}</span></>
            : <><strong className="idle">대기</strong><span>진행 중인 작업이 없습니다</span></>}
        </div>
      </div>
    </section>
    <div className="home-trio">
      <a className="card home-mini" href="#quality">
        <div className="qc-trend-head"><b>최근 7일 양품 · 불량</b><span>불량률 {rate(wGood, wBad)}</span></div>
        <div className="qc-legend"><span><i style={{ background: GOOD }}/>양품 {wGood}</span><span><i style={{ background: BAD }}/>불량 {wBad}</span><span className="qc-note">막대 위: 불량률</span></div>
        {buckets ? <Stack width={280} unit="개" mode="count" rows={goodBadRows(week)} top={(r) => rate(r.parts[0].value, r.parts[1].value)}/> : <p className="mes-muted">불러오는 중</p>}
      </a>
      <a className="card home-mini" href="#quality">
        <div className="qc-trend-head"><b>최근 7일 불량 원인</b><span>AI 판정 {causeTotal}건</span></div>
        <div className="qc-legend">{top3.length ? top3.map(([c, col, n], i) => <span key={c}><i style={{ background: col }}/>{i + 1}위 {CAUSE_KO[c]} {Math.round(n / causeTotal * 100)}%</span>) : <span className="qc-note">불량 원인 기록 없음</span>}</div>
        {buckets ? <Stack width={280} unit="건" mode="count" rows={causeRows(week)} top={(r) => String(r.parts.reduce((a, p) => a + p.value, 0))}/> : <p className="mes-muted">불러오는 중</p>}
      </a>
      <a className="card home-mini home-equip" href="#maintenance">
        <div className="qc-trend-head"><b>설비 상태</b><span>{fault ? '라인 정지' : '가동 가능'}</span></div>
        {fault && <p className={`home-equip-fault s-${fault.status.toLowerCase()}`}>● {assets.find((a) => a.code === fault.asset_code)?.name ?? fault.asset_code} · {fault.kind === 'BREAKDOWN' ? `${modeKo(fault.mode_code)} 고장` : '예방 정비'} · {STATUS_KO[fault.status]}</p>}
        <ul className="home-lights">{assets.map((a) => { const l = lightOf(a); return <li key={a.code} className={`l-${l}`}><i/><span>{a.name}</span><b>{LIGHT_KO[l]}</b><em>{a.health ?? '—'}</em></li> })}</ul>
        {!assets.length && <p className="mes-muted">설비 데이터를 불러오는 중</p>}
        <span className="home-equip-foot">숫자는 건강도(100 = 새 부품) · 누르면 설비 관리로 이동</span>
      </a>
    </div>
  </>
}
