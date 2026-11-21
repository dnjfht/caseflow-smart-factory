import { useEffect, useRef, useState } from 'react'
import TwinFallback from './TwinFallback'
import { TWIN_FRAME_ID, TWIN_URL, startTwinSync, twin } from './twin'
import './TwinHost.css'

// One twin frame for the whole MES: it loads when the MES opens and keeps the line running while the person
// moves between pages. A page that shows the line renders a <TwinSlot>, and the frame's box is laid over it.
// Moving an <iframe> in the DOM would reload it (and restart the line), so the frame never moves; only its box does.
// Without a GPU (WebGL and WebGPU both refused) the line still runs; the slot then shows a 2D view of it.

type View = 'overview' | 'robot' | 'shipping'
type Slot = { el: HTMLElement; view: View }
let current: Slot | null = null
let syncing = false
const listeners = new Set<() => void>()
const announce = () => listeners.forEach((l) => l())

export function TwinSlot({ view = 'overview', className = '' }: { view?: View; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const slot = { el: ref.current, view }
    current = slot
    announce()
    return () => {
      if (current === slot) current = null
      announce()
    }
  }, [view])
  return <div ref={ref} className={`twin-slot ${className}`}><span>3D 현장 불러오는 중…</span></div>
}

/** whether this browser can draw 3D at all (a GPU that crashed earlier leaves both refused until a restart) */
async function gpuAvailable(): Promise<boolean> {
  try {
    if (document.createElement('canvas').getContext('webgl2')) return true
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return !!(gpu && await gpu.requestAdapter())
  } catch { return false }
}

export default function TwinHost() {
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [slot, setSlot] = useState<Slot | null>(current)
  const [broken, setBroken] = useState(false)
  const retries = useRef(0)

  useEffect(() => { if (!syncing) { syncing = true; startTwinSync() } }, [])
  useEffect(() => {
    const l = () => setSlot(current)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  useEffect(() => { void gpuAvailable().then((ok) => { if (!ok) setBroken(true) }) }, [])

  // The frame reports "Renderer unavailable" when the GPU refuses it: reload it once by itself, then show the 2D view
  useEffect(() => {
    const id = window.setInterval(() => {
      try {
        const broke = !!frame.current?.contentDocument?.body?.innerText.includes('Renderer unavailable')
        if (!broke) return
        if (retries.current < 1) { retries.current++; reload() } else setBroken(true)
      } catch { /* still loading */ }
    }, 2000)
    return () => window.clearInterval(id)
  }, [])
  function reload() {
    setBroken(false)
    const f = frame.current
    if (f) f.src = TWIN_URL + '&t=' + Date.now()
  }

  // Lay the box over the slot. Whole pixels, and only when the slot moved or resized: a canvas resized every frame
  // by a fraction of a pixel makes the GPU reallocate its buffers every frame.
  useEffect(() => {
    const b = box.current
    if (!b) return
    if (!slot) {
      Object.assign(b.style, { left: '-10000px', top: '0px', width: '960px', height: '540px', visibility: 'hidden' })
      return
    }
    let raf = 0
    let last = ''
    const place = () => {
      const r = slot.el.getBoundingClientRect()
      const next = `${Math.round(r.left + window.scrollX)},${Math.round(r.top + window.scrollY)},${Math.floor(r.width)},${Math.floor(r.height)}`
      if (next !== last) {
        last = next
        const [l, t, w, h] = next.split(',')
        Object.assign(b.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px`, visibility: 'visible' })
      }
      raf = requestAnimationFrame(place)
    }
    place()
    const aim = window.setInterval(() => {
      const t = twin()
      if (t) { t.view(slot.view); window.clearInterval(aim) }
    }, 300)
    return () => { cancelAnimationFrame(raf); window.clearInterval(aim) }
  }, [slot])

  return <div ref={box} className="twin-box">
    <iframe ref={frame} id={TWIN_FRAME_ID} className="twin-frame" title="CaseFlow 3D 현장 (웹 트윈)" src={TWIN_URL} allow="fullscreen" />
    {broken && <div className="twin-fallback">
      <TwinFallback view={slot?.view ?? 'overview'} />
      <div className="twin-fallback-note">
        <span>이 브라우저는 지금 3D 그래픽(WebGL/WebGPU)을 쓸 수 없어 2D 공정 화면으로 표시합니다. 가상 공정과 PLC는 그대로 동작합니다.</span>
        <button onClick={() => { retries.current = 1; reload() }}>3D 다시 시도</button>
      </div>
    </div>}
  </div>
}
