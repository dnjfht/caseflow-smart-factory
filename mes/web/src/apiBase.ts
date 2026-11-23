import { authHeader, dropExpired } from './auth'

// The MES web is a static site; its API is the MES server on another host (VITE_API_BASE at build time).
// Every '/api/...' request the pages make goes there, carrying the signed-in user's token.
// Locally (no base) Vite's proxy serves /api.
const base = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '')
const originalFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === 'string' && input.startsWith('/api/')) {
    const headers = new Headers(init?.headers)
    for (const [k, v] of Object.entries(authHeader())) if (!headers.has(k)) headers.set(k, v)
    return originalFetch((base ?? '') + input, { ...init, headers }).then((r) => {
      // the server no longer accepts this token (it expired): sign out rather than fail every action
      if (r.status === 401 && headers.has('Authorization') && !input.startsWith('/api/auth/login')) dropExpired()
      return r
    })
  }
  return originalFetch(input, init)
}) as typeof fetch
/** an /api/... URL for places fetch does not cover (img src, links) */
export const apiUrl = (path: string) => (base ? base + path : path)
