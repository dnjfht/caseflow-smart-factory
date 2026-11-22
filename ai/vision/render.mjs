// node render.mjs outDir count seedBase
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
const [outDir, perClass, seedBase, port] = [process.argv[2], +process.argv[3], +process.argv[4], +(process.argv[5] ?? 5400)]
const only = process.argv[6]?.split(',')
const root = new URL('.', import.meta.url).pathname
const srv = createServer(async (q, s) => {
  try { const b = await readFile(join(root, q.url.split('?')[0])); s.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp' }[extname(q.url)] ?? 'application/octet-stream' }); s.end(b) } catch { s.writeHead(404); s.end() }
}).listen(port)
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage()
page.on('console', (m) => m.type() === 'error' && console.log('page:', m.text()))
await page.goto(`http://127.0.0.1:${port}/index.html`)
await page.waitForFunction(() => window.renderSample)
const classes = await page.evaluate(() => window.CLASSES)
let n = 0
for (const [ci, cls] of classes.entries()) {
  if (only && !only.includes(cls)) continue
  await mkdir(join(outDir, cls), { recursive: true })
  for (let i = 0; i < perClass; i++) {
    const seed = seedBase + ci * 100000 + i
    const url = await page.evaluate(([c, s]) => window.renderSample(c, s), [cls, seed])
    await writeFile(join(outDir, cls, `${cls}_${seed}.png`), Buffer.from(url.split(',')[1], 'base64'))
    if (++n % 200 === 0) console.log(n)
  }
}
await browser.close(); srv.close()
