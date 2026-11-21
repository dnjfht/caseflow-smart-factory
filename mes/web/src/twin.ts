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
  robot: {
    limits: [number, number][]
    joints(): number[] | null
    program(): RobotProgram
    jogTo(row: number[]): Promise<string | null>
    runJob(job: number): Promise<string | null>
    apply(p: { waypoints: number[][]; names: string[]; steps: number[][] }): string | null
  }
}

export const TWIN_URL = '/app/?scene=caseflow&present=1'
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
