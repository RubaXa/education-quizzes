/** Browser layout regression for teacher sheets with different page ratios.
 * @see ../docs/product/design-system.md#images
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const css = ['src/components/EducationImage.css', 'src/DayPage.css']
  .map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n')
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => path && existsSync(path))
if (!chrome) throw new Error('Для проверки нужен Chrome или CHROME_BIN.')

const page = (name, width, height) => {
  const image = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><text x="20" y="45" font-size="30">${name}</text><rect x="20" y="65" width="${width - 40}" height="${height - 85}" fill="#e8e0f7"/></svg>`).toString('base64')
  return `<div class="day-reader day-reader-statement"><div class="day-reader-heading"><strong>Лист учителя · 1 лист</strong><span>${name}</span></div><div class="day-reader-thumbs"><button class="day-reader-thumb"><span class="education-image" data-state="ready" style="height:auto;aspect-ratio:auto;--edu-image-fit:contain"><img src="data:image/svg+xml;base64,${image}" alt=""></span><small>Открыть лист крупно</small></button></div></div>`
}
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:12px;background:#f8f6fc;font:16px sans-serif}${css}</style>${page('Горизонтальный лист', 1200, 600)}${page('Вертикальный лист', 600, 900)}`

const profile = mkdtempSync(join(tmpdir(), 'education-material-preview-chrome-'))
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
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: true })
      const navigation = await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` })
      if (navigation.errorText) throw new Error(`Chrome не открыл страницу: ${navigation.errorText}`)
      await delay(170)
      const result = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify([...document.querySelectorAll('.day-reader-statement .education-image')].map(w=>{const i=w.querySelector('img'),r=w.getBoundingClientRect();return {height:r.height,expected:r.width*i.naturalHeight/i.naturalWidth,loaded:i.complete&&i.naturalWidth>0,overflow:r.right>innerWidth}}))` })
      if (result.exceptionDetails || !result.result?.value) throw new Error('Chrome не смог измерить листы.')
      const layout = JSON.parse(result.result.value)
      if (layout.length !== 2 || layout.some((item) => !item.loaded || item.overflow || Math.abs(item.height - item.expected) > 1)) throw new Error(`Неверные размеры превью: ${JSON.stringify({ width, layout })}`)
      if (width === 390 && process.env.MATERIAL_PREVIEW_SCREENSHOT_PATH) {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
        writeFileSync(process.env.MATERIAL_PREVIEW_SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'))
      }
      console.log(`${width}px: горизонтальный и вертикальный листы сохраняют пропорции`)
    }
  } finally { socket.close() }
} finally {
  proc.kill()
  await delay(300)
  rmSync(profile, { recursive: true, force: true })
}
