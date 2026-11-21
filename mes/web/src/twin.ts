// The web twin: the case-assembly line running in the browser (a patched Open Industry Project build served at
// /app/?scene=caseflow). It runs the same scene and ST program as the desktop OIP and exposes `window.caseflow`
// in its frame (same origin), which this module wraps for the MES pages.
import { useEffect, useState } from 'react'

export type Tags = Record<string, number | boolean | string>
export type RobotProgram = { waypoints: number[][]; names: string[]; jobs: number[][]; jobNames: string[] }
export type CaseflowApi = {
  ready: boolean
  tags(): Tags
  lineRunning(): boolean
  busy(): boolean
  view(name: 'overview' | 'robot' | 'shipping', instant?: boolean): void
  write(key: string, value: boolean | number): string | null
  press(key: 'HmiStart' | 'HmiStop'): Promise<void>
  reset(): Promise<void>
  robot: {
    limits: [number, number][]
    joints(): number[] | null
    program(): RobotProgram
    jogTo(row: number[]): Promise<string | null>
    runJob(job: number): Promise<string | null>
    apply(p: { waypoints: number[][]; names: string[]; steps: number[][] }): string | null
  }
}

// gfx=low: no MSAA, capped pixel ratio, clamped shadows - the twin shares the GPU with the MES page and laptops' integrated GPUs
export const TWIN_URL = '/app/?scene=caseflow&present=1&gfx=low'
export const TWIN_FRAME_ID = 'caseflow-twin'

/** the twin's API, or null while its frame is still loading */
export function twin(): CaseflowApi | null {
  const frame = document.getElementById(TWIN_FRAME_ID) as HTMLIFrameElement | null
  try {
    const api = (frame?.contentWindow as (Window & { caseflow?: CaseflowApi }) | null)?.caseflow
    return api?.ready ? api : null
  } catch {
    return null
  }
}

/** live PLC tags of the twin, polled */
export function useTwinTags(ms = 500): { ready: boolean; tags: Tags } {
  const [state, setState] = useState<{ ready: boolean; tags: Tags }>({ ready: false, tags: {} })
  useEffect(() => {
    const tick = () => {
      const t = twin()
      setState(t ? { ready: true, tags: t.tags() } : { ready: false, tags: {} })
    }
    tick()
    const id = window.setInterval(tick, ms)
    return () => window.clearInterval(id)
  }, [ms])
  return state
}

export const isStaticSite = import.meta.env.VITE_STATIC_DEMO === '1'

/** the MES's PLC snapshot shape, read from the twin's tags (the static site has no MES server to sample it) */
export function plcFromTags(t: Tags) {
  const n = (k: string) => Number(t[k] ?? 0)
  return {
    connected: true, message: '웹 트윈 PLC', sampledAt: new Date().toISOString(),
    target: n('TargetQuantity'), launched: n('LaunchedCount'), rejected: n('RejectCount'), packed: n('ProducedCount'), lineExit: n('ShippedCount'),
    machineState: n('MachineState'), assemblyPhase: n('AssemblyPhase'), inspectionPhase: n('InspectionPhase'), packingPhase: n('PackingPhase'),
    mesStop: t.MesPermit !== true, motorRunning: t.BodyConveyorRun === true,
  }
}

// ---- the link to the MES server -------------------------------------------------------------------------------
// One open MES drives the line at a time: its twin syncs tags to the server and applies the server's writes
// (permit, target, material). Others watch: their own twin idles and their panels show the driver's numbers.
export type LinkMode = 'connecting' | 'driver' | 'viewer' | 'offline' | 'static'
type LinkState = { mode: LinkMode; serverTags: Tags; message: string; field: boolean }
let link: LinkState = { mode: isStaticSite ? 'static' : 'connecting', serverTags: {}, message: '', field: false }
const linkListeners = new Set<(s: LinkState) => void>()
function setLink(next: Partial<LinkState>) { link = { ...link, ...next }; linkListeners.forEach((l) => l(link)) }
export function useTwinLink(): LinkState {
  const [s, set] = useState(link)
  useEffect(() => { linkListeners.add(set); return () => { linkListeners.delete(set) } }, [])
  return s
}

const SYNC_TAGS = ['M0', 'RunLatch', 'MesPermit', 'MesMaterialPermit', 'WorkOrderActive', 'TargetQuantity', 'MachineState', 'FaultCode',
  'LaunchedCount', 'RejectCount', 'ProducedCount', 'ShippedCount', 'AssemblyPhase', 'InspectionPhase', 'PackingPhase',
  'BodyConveyorRun', 'BodyStopper', 'LidStopper', 'RejectDiverter', 'RobotReady', 'PermitLamp', 'RunLamp', 'AlarmLamp',
  'BodyStockDisplay', 'LidStockDisplay']
const session = Math.random().toString(36).slice(2)
let lastReset: number | null = null
let lastProgram: number | null = null

/** the robot program last applied on any pendant, from the MES database */
export async function loadRobotProgram(t: CaseflowApi) {
  const r = await fetch('/api/twin/robot-program')
  if (!r.ok) return
  const body = await r.json() as { program?: { waypoints: number[][]; names: string[]; steps: number[][] } }
  if (body.program && !t.lineRunning()) t.robot.apply(body.program)
}

export function startTwinSync() {
  if (isStaticSite) return
  let busy = false
  window.setInterval(async () => {
    const t = twin()
    if (!t || busy) return
    busy = true
    try {
      const all = t.tags()
      const tags = Object.fromEntries(SYNC_TAGS.filter((k) => k in all).map((k) => [k, all[k]]))
      const r = await fetch('/api/twin/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, tags }) })
      if (!r.ok) throw Error(`HTTP ${r.status}`)
      const reply = await r.json() as { lease: boolean; writes: Tags; pulses: string[]; resetSeq: number; programSeq: number; fieldConnected: boolean; tags: Tags }
      if (!reply.lease) {
        // watching: keep this browser's own line idle so it never runs a second copy of the job
        if (all.MesPermit === true) t.write('MesPermit', false)
        setLink({ mode: 'viewer', serverTags: reply.tags, field: reply.fieldConnected, message: '다른 화면이 현장을 운전 중입니다. 이 화면은 관전 모드입니다.' })
        return
      }
      if (lastReset === null) lastReset = reply.resetSeq
      else if (reply.resetSeq !== lastReset) { lastReset = reply.resetSeq; await t.reset(); return }
      for (const [k, v] of Object.entries(reply.writes)) if (all[k] !== v && (typeof v === 'boolean' || typeof v === 'number')) t.write(k, v)
      // a start/stop pressed on OIP Desktop is pressed here too, so both copies run together
      for (const key of reply.pulses ?? []) if (key === 'HmiStart' || key === 'HmiStop') await t.press(key)
      if (lastProgram !== reply.programSeq) { lastProgram = reply.programSeq; void loadRobotProgram(t) }
      setLink({ mode: 'driver', serverTags: {}, field: reply.fieldConnected, message: '' })
    } catch {
      setLink({ mode: 'offline', message: 'MES 서버에 연결 중입니다. (무료 서버는 처음 깨어나는 데 30초쯤 걸립니다)' })
    } finally { busy = false }
  }, 500)
}
