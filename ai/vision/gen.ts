// CaseFlow inspection-image generator.
// Renders the OIP assembled case (tan cardboard body 0.3x0.3x0.15 m + blue cardboard lid 0.3x0.3x0.1 m) with the
// very mesh and cardboard textures OIP draws its cargo with, on a dark belt between conveyor rails, seen by an
// inspection camera above the line. Each sample is one class: OK or one defect cause.
import * as THREE from 'three'
import { cargoBoxMesh } from '../oip/src/render/parts/cargoBoxMesh'

export const CLASSES = ['OK', 'LID_MISSING', 'LID_MISALIGNED', 'SCRATCH', 'CRACK', 'CONTAMINATION', 'DENT'] as const

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = rej
    i.src = src
  })

const SIZE = 256
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(SIZE, SIZE)
renderer.setPixelRatio(1)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.outputColorSpace = THREE.SRGBColorSpace
document.body.appendChild(renderer.domElement)

const geo = (() => {
  const m = cargoBoxMesh()
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(m.indices, 1))
  g.scale(0.5, 0.5, 0.5)
  return g
})()

let base: { color: HTMLImageElement; normal: HTMLImageElement; rough: THREE.Texture } | null = null
async function init() {
  const [color, normal, roughImg] = await Promise.all([
    loadImg('BoxCardboard.webp'),
    loadImg('BoxCardboardNormal.webp'),
    loadImg('BoxCardboardRoughness.webp'),
  ])
  const rough = new THREE.Texture(roughImg)
  rough.flipY = false
  rough.needsUpdate = true
  base = { color, normal, rough }
}

// atlas cells (u0, v0, w, h) in UV units, v down: +Z side and +Y top, as cargoBoxMesh lays them out
const G = 6 / 1024
const TOP = [0 + G, 1 / 3 + G, 0.5 - 2 * G, 1 / 3 - 2 * G]
const SIDE = [0 + G, 0 + G, 0.5 - 2 * G, 1 / 3 - 2 * G]

function canvasOf(img: HTMLImageElement) {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  c.getContext('2d')!.drawImage(img, 0, 0)
  return c
}

function tex(c: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(c)
  t.flipY = false
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

type Painter = { color: CanvasRenderingContext2D; normal: CanvasRenderingContext2D; cw: number; nw: number }

// a point inside a face cell, kept away from the bevel band
function inCell(r: () => number, cell: number[], cw: number, margin = 0.12) {
  const u = cell[0] + cell[2] * (margin + r() * (1 - 2 * margin))
  const v = cell[1] + cell[3] * (margin + r() * (1 - 2 * margin))
  return [u * cw, v * cw]
}

// a groove in the normal map: two offset strokes tilt the normal either way across the line
function groove(p: Painter, pts: number[][], width: number, depth: number) {
  const k = p.nw / p.cw
  const n = p.normal
  n.lineCap = 'round'
  n.lineJoin = 'round'
  for (const [dx, col] of [
    [-0.6, `rgb(${128 - depth},${128 - depth},250)`],
    [0.6, `rgb(${128 + depth},${128 + depth},250)`],
  ] as const) {
    n.strokeStyle = col
    n.lineWidth = Math.max(1, width * k * 0.7)
    n.beginPath()
    pts.forEach(([x, y], i) => (i ? n.lineTo(x * k + dx, y * k + dx) : n.moveTo(x * k + dx, y * k + dx)))
    n.stroke()
  }
}

function stroke(c: CanvasRenderingContext2D, pts: number[][], style: string, width: number) {
  c.strokeStyle = style
  c.lineWidth = width
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.beginPath()
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
  c.stroke()
}

function scratch(p: Painter, r: () => number, cell: number[], severity: number) {
  const count = 1 + Math.floor(r() * 3)
  const span = cell[2] * p.cw
  for (let i = 0; i < count; i++) {
    const [x, y] = inCell(r, cell, p.cw, 0.15)
    const len = span * (0.18 + r() * 0.4) * (0.6 + severity * 0.5)
    const a = r() * Math.PI
    const pts: number[][] = []
    for (let s = 0; s <= 8; s++) {
      const f = s / 8 - 0.5
      pts.push([x + Math.cos(a) * len * f + (r() - 0.5) * 2, y + Math.sin(a) * len * f + (r() - 0.5) * 2])
    }
    const w = 3 + r() * 4
    // exposed fibre is lighter than the printed surface, with a shadowed lip
    stroke(p.color, pts.map(([u, v]) => [u + 1, v + 1]), `rgba(60,40,25,${0.25 * severity + 0.1})`, w + 1)
    stroke(p.color, pts, `rgba(250,236,210,${0.35 + 0.55 * severity})`, w)
    groove(p, pts, w + 1, 40 + 50 * severity)
  }
}

function crack(p: Painter, r: () => number, cell: number[], severity: number) {
  const span = cell[2] * p.cw
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    const pts = [[x, y]]
    const steps = 6 + Math.floor(r() * 6)
    for (let s = 0; s < steps; s++) {
      a += (r() - 0.5) * 1.1
      x += Math.cos(a) * (len / steps)
      y += Math.sin(a) * (len / steps)
      pts.push([x, y])
    }
    stroke(p.color, pts, `rgba(35,22,14,${0.55 + 0.4 * severity})`, w)
    stroke(p.color, pts.map(([u, v]) => [u - 1, v - 1]), `rgba(240,225,200,${0.25 * severity})`, Math.max(0.8, w * 0.4))
    groove(p, pts, w + 2, 70 + 50 * severity)
    if (depth < 2) {
      const n = Math.floor(r() * 3)
      for (let b = 0; b < n; b++) {
        const q = pts[1 + Math.floor(r() * (pts.length - 2))]
        branch(q[0], q[1], a + (r() < 0.5 ? 1 : -1) * (0.5 + r()), len * (0.3 + r() * 0.3), w * 0.6, depth + 1)
      }
    }
  }
  const [x, y] = inCell(r, cell, p.cw, 0.2)
  branch(x, y, r() * Math.PI * 2, span * (0.25 + 0.35 * severity), 4 + 5 * severity, 0)
}

function contamination(p: Painter, r: () => number, cell: number[], severity: number) {
  const kind = r()
  const blobs = 1 + Math.floor(r() * 4)
  const span = cell[2] * p.cw
  for (let b = 0; b < blobs; b++) {
    const [x, y] = inCell(r, cell, p.cw, 0.15)
    const rad = span * (0.05 + r() * 0.08) * (0.6 + severity * 0.6)
    let col: string
    if (kind < 0.3) col = `${20 + r() * 30},${15 + r() * 20},${8 + r() * 10}` // oil / grease
    else if (kind < 0.75) col = `${235},${232},${225}` // dust / powder
    else col = `${90 + r() * 40},${55 + r() * 20},${25}` // water stain / rust
    const alpha = 0.45 + 0.5 * severity
    for (let s = 0; s < 7; s++) {
      const ox = x + (r() - 0.5) * rad * 1.4
      const oy = y + (r() - 0.5) * rad * 1.4
      const rr = rad * (0.4 + r() * 0.7)
      const g = p.color.createRadialGradient(ox, oy, 0, ox, oy, rr)
      g.addColorStop(0, `rgba(${col},${alpha})`)
      g.addColorStop(0.7, `rgba(${col},${alpha * 0.6})`)
      g.addColorStop(1, `rgba(${col},0)`)
      p.color.fillStyle = g
      p.color.beginPath()
      p.color.arc(ox, oy, rr, 0, Math.PI * 2)
      p.color.fill()
    }
  }
}

function dent(p: Painter, r: () => number, cell: number[], severity: number) {
  const [x, y] = inCell(r, cell, p.cw, 0.22)
  const rad = cell[2] * p.cw * (0.08 + 0.1 * severity + r() * 0.05)
  // the dent's slope in the normal map: each pixel tilts toward the centre, deepest mid-radius
  const k = p.nw / p.cw
  const cx = x * k
  const cy = y * k
  const R = rad * k
  const n = p.normal
  const x0 = Math.floor(cx - R)
  const y0 = Math.floor(cy - R)
  const w = Math.ceil(2 * R)
  const img = n.getImageData(x0, y0, w, w)
  const strength = 0.45 + 0.4 * severity
  for (let j = 0; j < w; j++)
    for (let i = 0; i < w; i++) {
      const dx = x0 + i - cx
      const dy = y0 + j - cy
      const d = Math.hypot(dx, dy) / R
      if (d >= 1) continue
      const slope = Math.sin(d * Math.PI) * strength
      const nx = (-dx / (d * R + 1e-6)) * slope
      const ny = (-dy / (d * R + 1e-6)) * slope
      const o = (j * w + i) * 4
      img.data[o] = Math.max(0, Math.min(255, img.data[o] + nx * 127))
      img.data[o + 1] = Math.max(0, Math.min(255, img.data[o + 1] + ny * 127))
    }
  n.putImageData(img, x0, y0)
  // crushed board darkens in the hollow and shows crease lines
  const g = p.color.createRadialGradient(x, y, rad * 0.1, x, y, rad)
  g.addColorStop(0, `rgba(40,28,18,${0.18 + 0.2 * severity})`)
  g.addColorStop(1, 'rgba(40,28,18,0)')
  p.color.fillStyle = g
  p.color.beginPath()
  p.color.arc(x, y, rad, 0, Math.PI * 2)
  p.color.fill()
  const creases = 2 + Math.floor(r() * 3)
  for (let c = 0; c < creases; c++) {
    const a = r() * Math.PI * 2
    const pts = [
      [x + Math.cos(a) * rad * 0.15, y + Math.sin(a) * rad * 0.15],
      [x + Math.cos(a + 0.2) * rad * 0.8, y + Math.sin(a + 0.2) * rad * 0.8],
    ]
    stroke(p.color, pts, `rgba(50,35,22,${0.3 + 0.3 * severity})`, 3)
  }
}

// harmless marks an OK case still carries: a faint scuff or a few specks, well below a defect
function benign(p: Painter, r: () => number, cell: number[]) {
  if (r() < 0.5) {
    const [x, y] = inCell(r, cell, p.cw)
    const a = r() * Math.PI
    const len = cell[2] * p.cw * (0.03 + r() * 0.05)
    stroke(p.color, [[x, y], [x + Math.cos(a) * len, y + Math.sin(a) * len]], `rgba(250,236,210,${0.06 + r() * 0.08})`, 1)
  }
  const specks = Math.floor(r() * 5)
  for (let s = 0; s < specks; s++) {
    const [x, y] = inCell(r, cell, p.cw, 0.05)
    p.color.fillStyle = `rgba(40,30,20,${0.1 + r() * 0.15})`
    p.color.beginPath()
    p.color.arc(x, y, 0.8 + r() * 1.2, 0, Math.PI * 2)
    p.color.fill()
  }
}

function beltTexture(r: () => number) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  const shade = 30 + r() * 18
  g.fillStyle = `rgb(${shade},${shade + 1},${shade + 4})`
  g.fillRect(0, 0, 256, 256)
  const img = g.getImageData(0, 0, 256, 256)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 14
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n
  }
  g.putImageData(img, 0, 0)
  for (let x = 0; x < 256; x += 6 + Math.floor(r() * 6)) {
    g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`
    g.fillRect(x, 0, 1, 256)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(3, 2)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const disposables: { dispose(): void }[] = []
const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x)

export async function renderSample(cls: string, seed: number): Promise<string> {
  if (!base) await init()
  while (disposables.length) disposables.pop()!.dispose()
  const r = rng(seed)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color().setHSL(0.6, 0.05, 0.12 + r() * 0.1)

  // lighting: plant ceiling light plus the inspection lamp, both varied
  const warm = 0.06 + r() * 0.06
  scene.add(new THREE.HemisphereLight(new THREE.Color().setHSL(warm, 0.2, 0.85), 0x303035, 0.9 + r() * 0.9))
  const sun = new THREE.DirectionalLight(new THREE.Color().setHSL(warm, 0.15 + r() * 0.2, 0.9), 1.6 + r() * 2.2)
  const la = r() * Math.PI * 2
  sun.position.set(Math.cos(la) * 1.2, 1.6 + r() * 1.2, Math.sin(la) * 1.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(512, 512)
  sun.shadow.radius = 3
  Object.assign(sun.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6, near: 0.1, far: 5 })
  scene.add(sun)
  renderer.toneMappingExposure = 1.0 + r() * 0.6

  // belt and the conveyor's side rails
  const belt = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(2, 0.56)),
    keep(new THREE.MeshStandardMaterial({ map: keep(beltTexture(r)), roughness: 0.9 })),
  )
  belt.rotation.x = -Math.PI / 2
  belt.receiveShadow = true
  scene.add(belt)
  const railMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.55, 0.25, 0.62 + r() * 0.1), metalness: 0.5, roughness: 0.4 }))
  for (const z of [-0.3, 0.3]) {
    const rail = new THREE.Mesh(keep(new THREE.BoxGeometry(2, 0.07, 0.04)), railMat)
    rail.position.set(0, 0.035, z)
    rail.castShadow = rail.receiveShadow = true
    scene.add(rail)
  }

  // the parts' cardboard; the defect is painted onto one of them, the other keeps the shared textures
  // v2: defects go on the lid's top face, the face the top inspection camera sees. (v1 also put a quarter of them on
  // side faces, which this camera barely sees: labelled defects the image did not show, i.e. label noise.)
  const target = cls === 'OK' || cls === 'LID_MISSING' || cls === 'LID_MISALIGNED' ? 'none' : 'lid'
  const cell = TOP
  r(); r() // the two draws v1 spent on choosing the face (scenes stay close to v1, not identical)
  const material = (tint: THREE.Color, paint: ((p: Painter) => void) | null) => {
    const colorC = canvasOf(base!.color)
    const normalC = canvasOf(base!.normal)
    const p: Painter = { color: colorC.getContext('2d')!, normal: normalC.getContext('2d')!, cw: colorC.width, nw: normalC.width }
    // OK parts still carry the odd harmless mark
    if (r() < 0.6) benign(p, r, r() < 0.7 ? TOP : SIDE)
    paint?.(p)
    return keep(
      new THREE.MeshStandardMaterial({
        color: tint,
        map: keep(tex(colorC, true)),
        normalMap: keep(tex(normalC, false)),
        normalScale: new THREE.Vector2(1, -1),
        roughnessMap: base!.rough,
        roughness: 1,
        metalness: 0,
      }),
    )
  }
  const severity = 0.3 + r() * 0.7
  const painter = (p: Painter) => {
    if (cls === 'SCRATCH') scratch(p, r, cell, severity)
    else if (cls === 'CRACK') crack(p, r, cell, severity)
    else if (cls === 'CONTAMINATION') contamination(p, r, cell, severity)
    else if (cls === 'DENT') dent(p, r, cell, severity)
  }

  const jitter = (hex: string, d: number) => {
    const c = new THREE.Color(hex)
    const hsl = { h: 0, s: 0, l: 0 }
    c.getHSL(hsl)
    return new THREE.Color().setHSL(hsl.h + (r() - 0.5) * d * 0.2, hsl.s * (1 + (r() - 0.5) * d), hsl.l * (1 + (r() - 0.5) * d))
  }
  const caseGroup = new THREE.Group()
  const body = new THREE.Mesh(geo, material(jitter('#d5a86b', 0.15), target === 'body' ? painter : null))
  body.scale.set(0.3, 0.15, 0.3)
  body.position.y = 0.075
  body.castShadow = body.receiveShadow = true
  caseGroup.add(body)
  if (cls !== 'LID_MISSING') {
    const lid = new THREE.Mesh(geo, material(jitter('#367db5', 0.15), target === 'lid' ? painter : null))
    lid.scale.set(0.3, 0.1, 0.3)
    lid.position.y = 0.2
    lid.castShadow = lid.receiveShadow = true
    if (cls === 'LID_MISALIGNED') {
      const mode = r()
      if (mode < 0.4) {
        const a = r() * Math.PI * 2
        const off = 0.025 + r() * 0.05
        lid.position.x += Math.cos(a) * off
        lid.position.z += Math.sin(a) * off
      } else if (mode < 0.75) {
        lid.rotation.y = (r() < 0.5 ? -1 : 1) * (0.1 + r() * 0.3)
      } else {
        // lid sitting on one edge: a gap opens along the other
        const tilt = 0.06 + r() * 0.12
        if (r() < 0.5) lid.rotation.x = tilt
        else lid.rotation.z = tilt
        lid.position.y += 0.15 * Math.sin(tilt)
      }
    } else {
      // a good fit still sits a few millimetres off
      lid.position.x += (r() - 0.5) * 0.012
      lid.position.z += (r() - 0.5) * 0.012
      lid.rotation.y = (r() - 0.5) * 0.04
    }
    caseGroup.add(lid)
  }
  caseGroup.position.set((r() - 0.5) * 0.12, 0, (r() - 0.5) * 0.06)
  // the case rides square to the belt, +Z side toward the camera, give or take a few degrees
  caseGroup.rotation.y = (r() - 0.5) * 0.14
  scene.add(caseGroup)

  // inspection camera above the belt, slightly oblique so the lid top and the facing side are in view
  const cam = new THREE.PerspectiveCamera(30 + r() * 8, 1, 0.05, 10)
  const elev = 0.95 + r() * 0.45 // radians above horizontal
  const az = (r() - 0.5) * 0.5
  const dist = 0.78 + r() * 0.2
  cam.position.set(Math.sin(az) * Math.cos(elev) * dist, 0.15 + Math.sin(elev) * dist, Math.cos(az) * Math.cos(elev) * dist)
  cam.lookAt(caseGroup.position.x + (r() - 0.5) * 0.04, 0.14, caseGroup.position.z + (r() - 0.5) * 0.04)
  renderer.render(scene, cam)
  return renderer.domElement.toDataURL('image/png')
}

;(window as any).renderSample = renderSample
;(window as any).CLASSES = CLASSES
