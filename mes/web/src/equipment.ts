import { useEffect, useState } from 'react'

// 설비 관리 data, fetched once for every page that shows it (home light, equipment page, 3D scene banner)
export type Sensor = { key: string; name: string; unit: string; base: number; noise: number }
export type Prediction = { asset: string; mode: string; probability: number; remaining: number; probs: Record<string, number> }
export type Fault = {
  id: number; asset_code: string; mode_code: string | null; fault_code: number; kind: 'BREAKDOWN' | 'PREVENTIVE'
  status: 'LOCKED' | 'REPAIRING' | 'CONFIRMED'; life_no: number; units: number; order_id: number | null
  alarm_lead_units: number | null; predicted_mode: string | null; locked_at: string; repair_started_at: string | null
  repair_by: string | null; confirmed_at: string | null; confirmed_by: string | null; note: string | null
}
export type Alarm = { id: number; asset_code: string; mode_code: string; level: 'WARN' | 'ALERT'; raised_at: string; raised_units: number; probability: number; rul_at_raise: number | null; cleared_at: string | null; outcome: string | null }
export type Asset = {
  code: string; name: string; sensors: Sensor[]; latest: Record<string, number> | null; prediction: Prediction | null
  health: number | null; alarm: Alarm | null; fault: Fault | null; modes: { code: string; name: string }[]; units: number
}
export type Holdout = { accuracy: number; rulMae: number; falseAlarmRate: number; warnLead: number; alertLead: number; [k: string]: number }
export type Model = { version?: string; trainedAt?: string; reason?: string; syntheticLives?: number; lineLives?: number; samples?: number; trainMs?: number; holdout?: Record<string, Holdout>; warnProbability?: number; alertRul?: number }
export type Overview = { assets: Asset[]; openFault: Fault | null; speed: number; model: Model; modes: { code: string; name: string; asset: string; faultCode: number }[] }

// lower-case keys from Postgres, upper-case from H2: read both
export function lower<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v])) as T
}

export const MODE_KO: Record<string, string> = {
  NORMAL: '정상', BEARING_WEAR: '베어링 마모', BELT_SLIP: '벨트 미끄러짐', REDUCER_WEAR: '감속기 마모', JOINT_OVERHEAT: '관절 과열',
  VACUUM_LEAK: '진공 누설', MOTOR_OVERHEAT: '모터 과열', HEATER_DEGRADATION: '히터 열화',
}
export const modeKo = (m: string | null | undefined) => (m ? MODE_KO[m] ?? m : '—')
export const STATUS_KO: Record<Fault['status'], string> = { LOCKED: '잠금', REPAIRING: '수리 중', CONFIRMED: '확인 완료' }

export type Light = 'ok' | 'warn' | 'alert' | 'down' | 'idle'
export const LIGHT_KO: Record<Light, string> = { ok: '정상', warn: '주의', alert: '정비 권장', down: '고장 정지', idle: '데이터 수집 중' }
export function lightOf(a: Asset): Light {
  if (a.fault) return 'down'
  if (a.alarm) return a.alarm.level === 'ALERT' ? 'alert' : 'warn'
  if (a.health == null) return 'idle'
  return 'ok'
}

function normalize(o: Overview): Overview {
  const f = (x: Fault | null) => (x ? lower<Fault>(x as unknown as Record<string, unknown>) : null)
  const al = (x: Alarm | null) => (x ? lower<Alarm>(x as unknown as Record<string, unknown>) : null)
  return { ...o, openFault: f(o.openFault), assets: o.assets.map((a) => ({ ...a, fault: f(a.fault), alarm: al(a.alarm) })) }
}

let cache: Overview | null = null
const listeners = new Set<(o: Overview) => void>()
let timer = 0
export async function reloadEquipment() {
  try {
    const r = await fetch('/api/equipment')
    if (!r.ok) return
    cache = normalize(await r.json())
    listeners.forEach((l) => l(cache!))
  } catch { /* server asleep: keep the last view */ }
}

/** the equipment overview, refreshed every 3 s while any component shows it */
export function useEquipment() {
  const [o, set] = useState<Overview | null>(cache)
  useEffect(() => {
    listeners.add(set)
    if (listeners.size === 1) { void reloadEquipment(); timer = window.setInterval(reloadEquipment, 3000) }
    return () => { listeners.delete(set); if (!listeners.size) window.clearInterval(timer) }
  }, [])
  return o
}
