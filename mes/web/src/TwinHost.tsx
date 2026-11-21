import { useEffect, useRef, useState } from 'react'
import { TWIN_FRAME_ID, TWIN_URL, twin } from './twin'
import './TwinHost.css'

// One twin frame for the whole MES: it loads when the MES opens and keeps the line running while the person
// moves between pages. A page that shows the line renders a <TwinSlot>, and the frame is laid over it. Moving an
// <iframe> in the DOM would reload it (and restart the line), so the frame never moves; only its box does.

type Slot = { el: HTMLElement; view: 'overview' | 'robot' | 'shipping' }
let current: Slot | null = null
const listeners = new Set<() => void>()
const announce = () => listeners.forEach((l) => l())

export function TwinSlot({ view = 'overview', className = '' }: { view?: Slot['view']; className?: string }) {
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

export default function TwinHost() {
  const frame = useRef<HTMLIFrameElement>(null)
  const [slot, setSlot] = useState<Slot | null>(current)
  useEffect(() => {
    const l = () => setSlot(current)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  // follow the slot's box every frame while one is shown (scrolling, resizing, layout changes)
  useEffect(() => {
    const f = frame.current
    if (!f) return
    if (!slot) {
      Object.assign(f.style, { left: '-10000px', top: '0px', width: '1280px', height: '720px', visibility: 'hidden' })
      return
    }
    let raf = 0
    const place = () => {
      const r = slot.el.getBoundingClientRect()
      Object.assign(f.style, {
        left: `${r.left + window.scrollX}px`, top: `${r.top + window.scrollY}px`,
        width: `${r.width}px`, height: `${r.height}px`, visibility: 'visible',
      })
      raf = requestAnimationFrame(place)
    }
    place()
    // aim the camera for the page once the line is up
    const aim = window.setInterval(() => {
      const t = twin()
      if (t) { t.view(slot.view); window.clearInterval(aim) }
    }, 300)
    return () => { cancelAnimationFrame(raf); window.clearInterval(aim) }
  }, [slot])
  return <iframe ref={frame} id={TWIN_FRAME_ID} className="twin-frame" title="CaseFlow 3D 현장 (웹 트윈)" src={TWIN_URL} allow="fullscreen" />
}
