import { useEffect, useState } from 'react'

// Who is signed in. Every /api request carries the token (see apiBase.ts); the server decides what it allows.
// The pages only use the role to say up front what a button needs, instead of letting it fail.
export type Role = 'OPERATOR' | 'SUPERVISOR' | 'ADMIN'
export type Session = { token: string; expiresAt: number; user: { username: string; name: string; role: Role } }
export const ROLE_KO: Record<Role, string> = { OPERATOR: '생산 작업자', SUPERVISOR: '생산 관리자', ADMIN: '시스템 관리자' }
const RANK: Record<Role, number> = { OPERATOR: 1, SUPERVISOR: 2, ADMIN: 3 }
const KEY = 'caseflow.session'

function read(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Session | null
    return s && s.expiresAt * 1000 > Date.now() ? s : null
  } catch { return null }
}
let session: Session | null = read()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const currentSession = () => session
export const authHeader = (): Record<string, string> => (session ? { Authorization: `Bearer ${session.token}` } : {})

export async function login(username: string, password: string) {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw Error(body.detail || `HTTP ${r.status}`)
  session = body as Session
  try { localStorage.setItem(KEY, JSON.stringify(session)) } catch { /* storage may be off: the session lasts for this page */ }
  emit()
}

export function logout() {
  session = null
  try { localStorage.removeItem(KEY) } catch { /* nothing stored */ }
  emit()
}

/** the server no longer accepts the token (expired, or the server's key changed): sign out quietly */
export function dropExpired() { if (session) logout() }

export const can = (need: Role, s: Session | null = session) => !!s && RANK[s.user.role] >= RANK[need]
export const needText = (need: Role) => `${ROLE_KO[need]} 이상 로그인이 필요합니다`

export function useSession() {
  const [s, set] = useState(session)
  useEffect(() => {
    const l = () => set(session)
    listeners.add(l)
    const t = window.setInterval(() => { if (session && session.expiresAt * 1000 <= Date.now()) logout() }, 60000)
    return () => { listeners.delete(l); window.clearInterval(t) }
  }, [])
  return s
}
