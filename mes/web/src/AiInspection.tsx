import { useEffect, useState } from 'react'

export const CAUSE_KO: Record<string, string> = {
  OK: '정상', LID_MISSING: '뚜껑 누락', LID_MISALIGNED: '뚜껑 어긋남', SCRATCH: '스크래치', CRACK: '크랙',
  CONTAMINATION: '오염', DENT: '찍힘', UNSURE: '원인 불명(재검)',
}
const ko = (c: string) => CAUSE_KO[c] ?? c
type Row = Record<string, unknown>
type Live = { total: number; accuracy: number | null; defects: number; escaped: number; goods: number; falseReject: number; causeAccuracy: number | null; unsure: number; avgLatencyMs: number | null }
type Card = { version: string; input_size: number; threshold: { reject_p_defect: number; cause_min_confidence: number }; production: { defect_rate: number }; test: Record<string, number>; test_hard: Record<string, number>; classes: string[] }

const v = (r: Row, k: string) => r[k] ?? r[k.toUpperCase()]
const pct = (x: number | null | undefined, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`)

export default function AiInspection() {
  const [model, setModel] = useState<{ ready: boolean; failure: string | null; card: Card | null } | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  useEffect(() => {
    let gone = false
    const get = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject()))
    const load = () => {
      get('/api/ai/model').then((m) => !gone && setModel(m)).catch(() => {})
      get('/api/ai/live').then((m) => !gone && setLive(m)).catch(() => {})
      get('/api/ai/inspections?limit=12').then((m) => !gone && setRows(m)).catch(() => {})
    }
    load()
    const t = window.setInterval(load, 3000)
    return () => { gone = true; window.clearInterval(t) }
  }, [])
  const card = model?.card
  return <section className="card ai-card">
    <div className="op-title"><div><small>VISION AI INSPECTION</small><h2>AI 외관 검사 · 불량 원인 판정</h2></div>
      <span>{model == null ? '확인 중' : model.ready ? `모델 ${card?.version ?? ''} 가동` : '모델 없음'}</span></div>
    <p className="fine">검사 셀에 케이스가 도착하면 카메라 이미지(학습에 쓰지 않은 운영 이미지 풀에서 무작위, 불량률 {card ? pct(card.production.defect_rate, 0) : '—'})를 모델이 판정합니다. 이 판정이 OIP 데스크탑 PLC의 유일한 판정이고, 웹 트윈은 같은 판정을 그대로 따릅니다.</p>
    <div className="ai-kpis">
      <div><b>{live?.total ?? 0}</b><span>라인 판정 수</span></div>
      <div><b>{pct(live?.accuracy)}</b><span>원인 포함 정확도</span></div>
      <div className={live && live.escaped > 0 ? 'bad' : ''}><b>{live ? `${live.escaped} / ${live.defects}` : '—'}</b><span>불량 유출 (불량→양품)</span></div>
      <div><b>{live ? `${live.falseReject} / ${live.goods}` : '—'}</b><span>과검출 (양품→불량)</span></div>
      <div><b>{pct(live?.causeAccuracy)}</b><span>불량 원인 정확도</span></div>
      <div><b>{live?.avgLatencyMs == null ? '—' : `${live.avgLatencyMs.toFixed(0)} ms`}</b><span>평균 추론 시간</span></div>
    </div>
    {card && <div className="ai-model">
      <div><b>판정 기준</b><p>불량 확률 ≥ {card.threshold.reject_p_defect.toFixed(2)} 이면 불량 · 원인 확신 {pct(card.threshold.cause_min_confidence, 0)} 미만은 재검</p></div>
      <div><b>시험 성능 (보정 후)</b><p>정확도 {pct(card.test.accuracy)} · 불량 유출 {pct(card.test.defect_escape)} · 과검출 {pct(card.test.false_reject)}</p></div>
      <div><b>열악 조건 시험</b><p>정확도 {pct(card.test_hard.accuracy)} · 불량 유출 {pct(card.test_hard.defect_escape)}</p></div>
    </div>}
    {!model?.ready && model?.failure && <p className="fine">모델을 불러오지 못했습니다: {model.failure}</p>}
    <div className="ai-shots">
      {rows.map((r) => {
        const truth = String(v(r, 'true_label')), cause = String(v(r, 'cause')), good = Boolean(v(r, 'verdict_good'))
        const right = good ? truth === 'OK' : truth === cause
        return <figure key={String(v(r, 'id'))} className={right ? '' : 'miss'}>
          <img src={`/api/ai/image/${String(v(r, 'image'))}`} alt={ko(truth)} loading="lazy" />
          <figcaption><strong className={good ? 'ok' : 'ng'}>{good ? '양품' : `불량 · ${ko(cause)}`}</strong>
            <span>#{String(v(r, 'seq'))} · 신뢰도 {pct(Number(v(r, 'confidence')), 0)}</span>
            <span>실제: {ko(truth)}{right ? '' : ' ✗'}</span></figcaption>
        </figure>
      })}
      {rows.length === 0 && <p className="fine">아직 판정한 제품이 없습니다. 작업을 시작하면 검사 셀에 도착하는 순서대로 나타납니다.</p>}
    </div>
  </section>
}
