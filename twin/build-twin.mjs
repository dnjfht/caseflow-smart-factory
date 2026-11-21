// Builds the CaseFlow web twin (a patched Open Industry Project browser build) into the MES site.
//
//   node twin/build-twin.mjs <out-dir>        (mes/web runs it after its own build on Render)
//
// The simulator is not vendored: the pinned upstream commit (twin/OIP_COMMIT) is fetched, twin/caseflow-twin.patch
// is applied, and the result is built with Node 24 (OIP requires it). The line itself is oip/project, zipped into
// /caseflow/caseflow.oip, so the twin always runs the same scene and ST program the desktop OIP does.
// Skipped unless RENDER or BUILD_TWIN is set, so a local `npm run build` stays fast.
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const out = resolve(process.argv[2] ?? join(repo, 'mes/web/dist'))
if (!process.env.RENDER && !process.env.BUILD_TWIN) {
  console.log('[twin] skipped (set BUILD_TWIN=1 to build the web twin locally)')
  process.exit(0)
}
const work = resolve(process.env.TWIN_WORKDIR ?? join(repo, '.twin-build'))
const src = join(work, 'oip')
const commit = readFileSync(join(here, 'OIP_COMMIT'), 'utf8').trim()
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts })

mkdirSync(work, { recursive: true })
if (!existsSync(join(src, '.git'))) {
  sh(`git init -q "${src}"`)
  sh('git remote add origin https://github.com/Open-Industry-Project/Open-Industry-Project.git', { cwd: src })
}
sh(`git fetch -q --depth 1 origin ${commit}`, { cwd: src })
sh('git checkout -q -f FETCH_HEAD && git clean -qfd', { cwd: src })
sh(`git apply "${join(here, 'caseflow-twin.patch')}"`, { cwd: src })

// Node 24 from the npm registry when the build host has an older one
let node = 'node'
if (Number(process.versions.node.split('.')[0]) < 24) {
  const n24 = join(work, 'node24')
  if (!existsSync(join(n24, 'node_modules/node/bin/node'))) sh(`npm i --prefix "${n24}" --no-audit --no-fund node@24`)
  node = join(n24, 'node_modules/node/bin/node')
}
// npm itself can stay on the host's Node; the scripts it runs (vite, the asset optimizer) take node 24 off the PATH
const env = { ...process.env, PATH: `${dirname(node === 'node' ? process.execPath : node)}:${process.env.PATH}`, CASEFLOW_TWIN: '1' }
const npm = (args) => sh(`npm ${args}`, { cwd: src, env })
npm('ci --no-audit --no-fund')
npm('run build')

// the line: oip/project zipped as a .oip (the folder layout, zipped)
const { zipSync } = await import(join(src, 'node_modules/fflate/esm/index.mjs'))
const project = join(repo, 'oip/project')
const tree = {}
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const rel = relative(project, p).split('\\').join('/')
    if (name.startsWith('.') || rel === 'AGENTS.md') continue
    if (statSync(p).isDirectory()) walk(p)
    else tree[rel] = [new Uint8Array(readFileSync(p)), { level: 6, mtime: new Date(2000, 0, 1) }]
  }
}
walk(project)
const dist = join(src, 'dist')
mkdirSync(join(dist, 'caseflow'), { recursive: true })
writeFileSync(join(dist, 'caseflow/caseflow.oip'), zipSync(tree))

// copy what the twin needs into the site; the simulator's own landing, videos and docs stay out
const keep = ['app', 'assets', 'models', 'textures', 'part-assets', 'fonts', 'thumbnails', 'icons', 'caseflow', 'st-capabilities.json']
for (const k of keep) if (existsSync(join(dist, k))) cpSync(join(dist, k), join(out, k), { recursive: true })
mkdirSync(join(out, 'twin-licenses'), { recursive: true })
for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES.txt']) if (existsSync(join(dist, f))) cpSync(join(dist, f), join(out, 'twin-licenses', f))
console.log(`[twin] built ${commit.slice(0, 7)} + caseflow patch into ${out}`)
if (process.env.TWIN_CLEAN) rmSync(work, { recursive: true, force: true })
