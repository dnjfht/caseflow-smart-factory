import { useEffect, useState } from 'react'
import { can, ROLE_KO, useSession, type Role } from './auth'

type Row = Record<string, unknown>
const v = (r: Row, k: string) => r[k] ?? r[k.toUpperCase()]
const ACTION_KO: [RegExp, string][] = [
  [/^POST \/api\/twin\/press$/, '조작반 시작/정지'], [/^POST \/api\/plc\/stop$/, '라인 정지'],
  [/^POST \/api\/plans$/, '생산 계획 작성'], [/^POST \/api\/plans\/\d+\/approve$/, '생산 계획 승인'], [/^POST \/api\/plans\/\d+\/release$/, '작업지시 발행'],
  [/^POST \/api\/lots$/, '자재 입고'], [/^POST \/api\/orders\/\d+\/start$/, 'MES 가동 허가'], [/^POST \/api\/orders\/\d+\/pause$/, '일시정지(허가 회수)'],
  [/^POST \/api\/orders\/\d+\/resume$/, '허가 재발행'], [/^POST \/api\/orders\/\d+\/recover$/, '남은 수량 재개'], [/^POST \/api\/orders\/\d+\/close$/, '작업 마감'],
  [/^POST \/api\/twin\/robot-program$/, '로봇 프로그램 적용'], [/^LOGIN /, '로그인 실패'],
]
const ko = (a: string) => ACTION_KO.find(([re]) => re.test(a))?.[1] ?? a

/** who did what, when, and whether the MES allowed it */
export default function AuditLog() {
  const session = useSession()
  const allowed = can('SUPERVISOR', session)
  const [rows, setRows] = useState<Row[]>([])
  useEffect(() => {
    if (!allowed) return
    let gone = false
    const load = () => fetch('/api/auth/audit?limit=30').then((r) => r.ok ? r.json() : []).then((d) => !gone && setRows(d)).catch(() => {})
    load()
    const t = window.setInterval(load, 10000)
    return () => { gone = true; window.clearInterval(t) }
  }, [allowed])
  return <section className="card">
    <div className="op-title"><div><small>AUDIT TRAIL</small><h2>사용자 작업 기록</h2></div><span>{allowed ? `최근 ${rows.length}건` : '생산 관리자 이상'}</span></div>
    {!allowed ? <p className="mes-muted">누가 언제 무엇을 했는지(허용·거부 포함)는 생산 관리자 이상으로 로그인하면 볼 수 있습니다.</p>
      : <div className="op-table-wrap"><table className="ai-log"><thead><tr><th>시각</th><th>사용자</th><th>역할</th><th>작업</th><th>결과</th></tr></thead>
        <tbody>{rows.map((r, i) => { const res = String(v(r, 'result')); return <tr key={i} style={{ cursor: 'default' }}>
          <td data-label="시각">{new Date(String(v(r, 'at'))).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
          <td data-label="사용자">{String(v(r, 'display_name') ?? v(r, 'username') ?? '—')}</td>
          <td data-label="역할">{v(r, 'role') ? ROLE_KO[String(v(r, 'role')) as Role] : '—'}</td>
          <td data-label="작업">{ko(String(v(r, 'action')))}</td>
          <td data-label="결과"><em className={res === 'OK' ? 'ok' : 'ng'}>{res === 'OK' ? '완료' : res === 'DENIED' ? '권한 없음' : '실패'}</em></td></tr> })}
          {rows.length === 0 && <tr><td colSpan={5} className="mes-muted">기록이 없습니다.</td></tr>}</tbody></table></div>}
  </section>
}
