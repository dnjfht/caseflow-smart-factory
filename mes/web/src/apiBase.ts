// The MES web is a static site; its API is the MES server on another host (VITE_API_BASE at build time).
// Every '/api/...' request the pages make goes there. Locally (no base) Vite's proxy serves /api.
const base = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '')
if (base) {
  const originalFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) return originalFetch(base + input, init)
    return originalFetch(input, init)
  }) as typeof fetch
}
export {}
