/** Browser geometry regression for teacher-sheet crops.
 * @see ../docs/shared/design/README.md#images
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const css = ['src/components/EducationImage.css', 'src/components/SourceFragment.css']
  .map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n')
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => path && existsSync(path))
if (!chrome) throw new Error('Для проверки нужен Chrome или CHROME_BIN.')

const crop = { x: 130, y: 1248, width: 1070, height: 135, sourceWidth: 1323, sourceHeight: 1871 }
const original = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${crop.sourceWidth}" height="${crop.sourceHeight}"><rect width="100%" height="100%" fill="white"/><rect x="${crop.x}" y="${crop.y}" width="${crop.width}" height="${crop.height}" fill="navy"/></svg>`).toString('base64')
const localImage = process.env.SOURCE_FRAGMENT_IMAGE_PATH ? readFileSync(process.env.SOURCE_FRAGMENT_IMAGE_PATH) : null
let server
let serverUrl
if (localImage) {
  server = createServer((request, response) => {
    if (request.url?.startsWith('/image.png')) { response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(localImage); return }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(fixture('/image.png'))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  serverUrl = `http://127.0.0.1:${server.address().port}/`
}
function fixture(imageSrc = `data:image/svg+xml;base64,${original}`) {
  const image = (className) => `<span class="education-image education-image-crop ${className}" data-state="ready" style="aspect-ratio:${crop.width}/${crop.height};--edu-crop-width:${crop.sourceWidth / crop.width * 100}%;--edu-crop-left:${-crop.x / crop.width * 100}%;--edu-crop-top:${-crop.y / crop.height * 100}%"><img src="${imageSrc}" alt="Условие задачи"></span>`
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:12px;font:16px sans-serif}${css}</style>
    <div class="source-fragment"><button class="source-fragment-trigger">${image('small')}<small>Фрагмент № 6 · открыть крупно</small></button></div>
    <div class="source-fragment-stage">${image('source-fragment-large')}</div>`
}

const profile = mkdtempSync(join(tmpdir(), 'education-source-fragment-chrome-'))
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
try {
  let port
  for (let attempt = 0; attempt < 50; attempt++) {
    try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break }
    catch { await delay(100) }
  }
  if (!port) throw new Error('Chrome DevTools не запустился.')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const target = targets.find((entry) => entry.type === 'page')
  if (!target) throw new Error('Chrome не открыл страницу проверки.')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let nextId = 0
  const pending = new Map()
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data)
    const handlers = pending.get(data.id)
    if (!handlers) return
    pending.delete(data.id)
    if (data.error) handlers.reject(new Error(JSON.stringify(data.error)))
    else handlers.resolve(data.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  try {
    for (const width of [320, 390, 540]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
      const pageUrl = serverUrl ? `${serverUrl}?width=${width}` : `data:text/html;base64,${Buffer.from(fixture()).toString('base64')}`
      const navigation = await send('Page.navigate', { url: pageUrl })
      if (navigation.errorText) throw new Error(`Chrome не открыл фрагмент: ${navigation.errorText}`)
      await delay(160)
      const result = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify([...document.querySelectorAll('.education-image-crop')].map(w=>{const i=w.querySelector('img'),r=w.getBoundingClientRect(),p=i.getBoundingClientRect(),scale=p.width/${crop.sourceWidth};return{className:w.className,height:r.height,expectedHeight:r.width*${crop.height}/${crop.width},xError:Math.abs(p.left-(r.left-${crop.x}*scale)),yError:Math.abs(p.top-(r.top-${crop.y}*scale)),loaded:i.complete&&i.naturalWidth>0}}))` })
      if (result.exceptionDetails || !result.result?.value) throw new Error('Chrome не смог измерить фрагмент.')
      const layout = JSON.parse(result.result.value)
      const bad = layout.find((item) => !item.loaded || Math.abs(item.height - item.expectedHeight) > 1 || item.xError > 1 || item.yError > 1)
      if (layout.length !== 2 || bad) throw new Error(`Фрагмент выходит из видимой области: ${JSON.stringify({ width, count: layout.length, bad })}`)
      if (width === 320 && process.env.SOURCE_FRAGMENT_SCREENSHOT_PATH) {
        const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        writeFileSync(process.env.SOURCE_FRAGMENT_SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'))
      }
      console.log(`${width}px: миниатюра и крупный фрагмент совпадают с координатами оригинала`)
    }
  } finally { socket.close() }
} finally {
  proc.kill()
  await delay(300)
  rmSync(profile, { recursive: true, force: true })
  if (server) await new Promise((resolve) => server.close(resolve))
}
