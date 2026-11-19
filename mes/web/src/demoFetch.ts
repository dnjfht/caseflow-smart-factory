import { previewScene } from './demoScene'

// Public hosting serves a fixed, anonymized preview. Local builds keep the real API.
if (import.meta.env.VITE_STATIC_DEMO === '1') {
  document.body.dataset.demo = 'true'
  const originalFetch = globalThis.fetch.bind(globalThis)
  const preview = (path: string) => originalFetch(`/demo/${path}.json`).then(async response => {
    if (!response.ok) throw new Error(`Preview data unavailable: ${path}`)
    return response.json()
  })
  const json = (value: unknown, status = 200) => Response.json(value, { status })
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
    if (!url.startsWith('/api/')) return originalFetch(input, init)
    if ((init?.method || 'GET').toUpperCase() !== 'GET') {
      return Promise.resolve(json({ detail: '공개 화면은 읽기 전용입니다. 현장 PC의 MES에서 작업을 실행하세요.' }, 403))
    }
    if (url === '/api/overview') return preview('overview').then(json)
    if (url === '/api/scene/layout') return preview('layout').then(json)
    if (url === '/api/scene/runtime') return Promise.resolve(json(previewScene()))
    if (url === '/api/robot/status') return Promise.resolve(json({ RECIPE: 'ASSEMBLY_DEMO', SPEED_PCT: 100, ENABLED: false, STATE: 'OFFLINE', DETAIL: '공개 화면은 현장 로봇에 연결되지 않습니다.', COMPLETED_CYCLES: 0, PLC_CONNECTED: false, ACTION_AVAILABLE: false, BRIDGE_ALIVE: false, BRIDGE_UPDATED_AT: '' }))
    if (url === '/api/robot/program' || url.startsWith('/api/trace/')) return Promise.resolve(json([]))
    if (url === '/api/ai/status') return Promise.resolve(json({ modelState: 'UNTRAINED', sampleCount: 0, lastSample: '', qualityLabels: '', maintenanceLabels: '', sensorInputs: '' }))
    return Promise.resolve(json({ detail: '공개 미리보기에서는 사용할 수 없습니다.' }, 404))
  }) as typeof fetch
}
