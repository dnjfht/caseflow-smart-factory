import { useState } from 'react'
import { createPortal } from 'react-dom'
import { login, logout, NEED_ROLES, ROLE_KO, ROLES, useSession, type Need, type Role } from './auth'

// what each role may do: the same rules the server enforces (AuthInterceptor)
export const PERMISSIONS: [string, Need | null][] = [
  ['모든 화면 조회 (설비 관리 포함)', null],
  ['현장 조작반 시작 · 정지', 'PRODUCTION'],
  ['생산 계획 작성', 'PRODUCTION'],
  ['자재 입고 등록', 'PRODUCTION'],
  ['생산 계획 승인 (작성자 본인 제외)', 'MANAGEMENT'],
  ['작업지시 발행 · MES 가동 허가 · 일시정지 · 종료', 'MANAGEMENT'],
  ['로봇 프로그램 저장', 'MANAGEMENT'],
  ['사용자 작업 기록 조회', 'MANAGEMENT'],
  ['설비 고장 수리 시작 · 수리 확인(재가동)', 'MAINTENANCE'],
  ['예방 정비 · 예지보전 모델 재학습', 'MAINTENANCE'],
  ['계정 목록 관리 · 시연 마모 배율', 'ADMIN'],
]
const DEMO: { username: string; password: string; role: Role; name: string }[] = [
  { username: 'operator1', password: 'operator1234', role: 'OPERATOR', name: '김현장' },
  { username: 'supervisor1', password: 'supervisor1234', role: 'SUPERVISOR', name: '이반장' },
  { username: 'maint1', password: 'maint1234', role: 'MAINTENANCE', name: '박정비' },
  { username: 'admin', password: 'admin1234', role: 'ADMIN', name: '시스템관리자' },
]
const SHORT: Record<Role, string> = { OPERATOR: '작업자', SUPERVISOR: '생산 관리자', MAINTENANCE: '설비 관리자', ADMIN: '시스템' }

export default function AccountMenu() {
  const session = useSession()
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (u = username, p = password) => {
    setBusy(true); setError('')
    try { await login(u, p); setOpen(false); setPassword('') } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return <>
    {session
      ? <div className="account"><span className={`role-badge r-${session.user.role.toLowerCase()}`}>{ROLE_KO[session.user.role]}</span><b>{session.user.name}</b>
          <button type="button" onClick={() => setOpen(true)}>권한</button><button type="button" onClick={logout}>로그아웃</button></div>
      : <div className="account"><span className="role-badge">조회 전용</span><button type="button" className="primary" onClick={() => setOpen(true)}>로그인</button></div>}
    {open && createPortal(<div className="ai-modal" role="dialog" aria-modal="true" aria-label="로그인" onClick={() => setOpen(false)}>
      <div className="login-box" onClick={(e) => e.stopPropagation()}>
        <header><b>{session ? `${session.user.name} · ${ROLE_KO[session.user.role]}` : 'CaseFlow MES 로그인'}</b><button onClick={() => setOpen(false)} aria-label="닫기">×</button></header>
        <div className="login-body">
          {!session && <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
            <label>아이디<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required/></label>
            <label>비밀번호<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required/></label>
            {error && <p className="op-message op-error">{error}</p>}
            <button className="primary" disabled={busy}>{busy ? '확인 중' : '로그인'}</button>
            <div className="demo-accounts"><small>포트폴리오 시연용 계정 (누르면 바로 로그인)</small>
              {DEMO.map((d) => <button type="button" key={d.username} disabled={busy} onClick={() => void submit(d.username, d.password)}>
                <span className={`role-badge r-${d.role.toLowerCase()}`}>{ROLE_KO[d.role]}</span>{d.name} · {d.username}</button>)}</div>
          </form>}
          <table className="perm-table"><thead><tr><th>할 수 있는 일</th>{ROLES.map((r) => <th key={r}>{SHORT[r]}</th>)}</tr></thead>
            <tbody>{PERMISSIONS.map(([what, need]) => <tr key={what}><td>{what}</td>{ROLES.map((r) => { const ok = !need || NEED_ROLES[need].includes(r); return <td key={r} className={ok ? 'yes' : 'no'}>{ok ? '●' : '—'}</td> })}</tr>)}</tbody></table>
          <p className="fine">로그인하지 않으면 모든 화면을 볼 수만 있습니다. 생산과 설비 정비는 권한이 나뉘어 있어, 설비 관리자는 생산을 조작하지 않고 생산 관리자는 수리 확인을 하지 않습니다. 실행한 작업은 누가 언제 했는지 '이벤트 이력'의 사용자 작업 기록에 남습니다. 현장 PC 에이전트와 웹 트윈의 신호 동기화는 설비 간 통신이라 로그인 대상이 아닙니다.</p>
        </div>
      </div>
    </div>, document.body)}
  </>
}
