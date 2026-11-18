// Virtual assembly, inspection and packing fixtures for the case line.
// Assembly consumes one body and one lid and emits an assembled case.
// Inspection alternates accepted and rejected results so both routes can be tested.
// Packing marks the accepted case before the shipping sensors count it.

let running = false
let elapsed = 0
let done = false
let inspected = 0
let occupied = false

definePart({
  params: {
    mode: { type: 'enum', default: 'assembly', label: 'Process', options: [
      { value: 'assembly', label: 'Assembly' },
      { value: 'inspection', label: 'Inspection' },
      { value: 'packing', label: 'Packing' },
    ] },
    startTag: { type: 'tag', dir: 'in', stType: 'BOOL', default: '', label: 'Start command', group: 'Comms' },
    completeTag: { type: 'tag', dir: 'in', stType: 'BOOL', default: '', label: 'Robot released lid', group: 'Comms' },
    readyTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Ready', group: 'Comms' },
    doneTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Done', group: 'Comms' },
    validTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Result valid', group: 'Comms' },
    goodTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Accepted', group: 'Comms' },
    debugRunningTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Debug running', group: 'Comms' },
    debugRobotTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Debug robot complete', group: 'Comms' },
    debugMainTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Debug main occupied', group: 'Comms' },
  },
  step(ctx) {
    const p = ctx.params
    const hasMain = ctx.zone('main') > 0
    const hasSecondary = ctx.zone('secondary') > 0
    const start = p.startTag ? ctx.readTag(p.startTag) : false
    const ready = p.mode === 'assembly' ? hasMain && hasSecondary && !running : hasMain && !running
    if (p.readyTag) ctx.writeTag(p.readyTag, ready)
    if (p.mode === 'assembly') {
      if (p.debugRunningTag) ctx.writeTag(p.debugRunningTag, running)
      if (p.debugRobotTag) ctx.writeTag(p.debugRobotTag, p.completeTag ? ctx.readTag(p.completeTag) : false)
      if (p.debugMainTag) ctx.writeTag(p.debugMainTag, hasMain)
      if (start && ready && !running && !done) { running = true; elapsed = 0 }
      if (running && p.completeTag && ctx.readTag(p.completeTag) && hasMain) {
        ctx.join('main')
        ctx.mark('main', 'assembled', true)
        running = false
        done = true
      }
      if (done && !start) done = false
      if (p.doneTag) ctx.writeTag(p.doneTag, done)
      return
    }
    if (p.mode === 'inspection') {
      if (!hasMain) { running = false; done = false; occupied = false; elapsed = 0 }
      if (hasMain && !occupied && start) { occupied = true; running = true; elapsed = 0; done = false }
      if (running) {
        elapsed += ctx.dt
        if (elapsed >= 0.75) { inspected++; running = false; done = true }
      }
      if (p.validTag) ctx.writeTag(p.validTag, done)
      if (p.goodTag) ctx.writeTag(p.goodTag, done && inspected % 2 === 1)
      return
    }
    if (!hasMain) { running = false; done = false; occupied = false; elapsed = 0 }
    if (hasMain && !occupied && start) { occupied = true; running = true; elapsed = 0 }
    if (running) {
      elapsed += ctx.dt
      if (elapsed >= 1.0) {
        ctx.mark('main', 'packed', true)
        ctx.dress('main', { id: 'casePack', material: 'packFilm', opacity: 0.8 })
        running = false
        done = true
      }
    }
    if (p.doneTag) ctx.writeTag(p.doneTag, done)
  },
})
