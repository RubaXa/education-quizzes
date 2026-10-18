/** Browser regression for the Telegram UI Kit at mobile and narrow desktop widths.
 * Run with: node scripts/check-telegram-preview-viewport.mjs
 * @see ../docs/shared/design/telegram.md#визуальная-система
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => path && existsSync(path))
if (!chrome) throw new Error('Для проверки нужен Chrome или CHROME_BIN.')

const port = Number(process.env.TELEGRAM_PREVIEW_PORT ?? 4178)
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: root, stdio: 'ignore' })
const profile = mkdtempSync(join(tmpdir(), 'education-telegram-preview-chrome-'))
const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const screenshotDir = resolve(root, '.local/screenshots')
mkdirSync(screenshotDir, { recursive: true })

try {
  let serverReady = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`)
      if (response.ok) { serverReady = true; break }
    } catch { /* Vite is still starting. */ }
    await delay(100)
  }
  if (!serverReady) throw new Error('Локальный Vite server не запустился.')

  let devtoolsPort
  for (let attempt = 0; attempt < 50; attempt++) {
    try { devtoolsPort = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break }
    catch { await delay(100) }
  }
  if (!devtoolsPort) throw new Error('Chrome DevTools не запустился.')
  const targets = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json`)).json()
  const target = targets.find((entry) => entry.type === 'page')
  if (!target) throw new Error('Chrome не открыл страницу проверки.')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let nextId = 0
  const pending = new Map()
  const externalRequests = []
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data)
    if (data.method === 'Network.requestWillBeSent') {
      const requestUrl = new URL(data.params.request.url)
      if (!['127.0.0.1', 'localhost'].includes(requestUrl.hostname)) externalRequests.push(requestUrl.href)
    }
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
    await send('Network.enable')
    for (const width of [320, 390, 540]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: true })
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/#/ui-kit` })
      await delay(1000)
      await send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{const button=[...document.querySelectorAll('nav button')].find(item=>item.textContent.includes('Telegram-уведомления'));if(!button)throw Error('Telegram UI Kit section missing');button.click()})()` })
      await delay(100)

      for (const mode of ['short', 'long', 'no-context']) {
        const changed = await send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{const select=document.querySelector('select[aria-label="Содержание уведомления"]');if(!select)throw Error('content selector missing');select.value=${JSON.stringify(mode)};select.dispatchEvent(new Event('change',{bubbles:true}));return true})()` })
        if (!changed.result?.value) throw new Error(`Could not switch preview to ${mode}`)
        await delay(120)
        const measured = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify((()=>{const stage=document.querySelector('.edu-telegram-stage'),message=document.querySelector('.edu-telegram-message'),primary=document.querySelector('.edu-telegram-primary-content');const rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width,scroll:e.scrollWidth,client:e.clientWidth}};return{viewport:innerWidth,document:document.documentElement.scrollWidth,stage:rect(stage),message:rect(message),primary:primary?rect(primary):null,headline:document.querySelector('.edu-telegram-message-heading h3')?.textContent}})())` })
        if (measured.exceptionDetails || !measured.result?.value) throw new Error('Chrome не смог измерить предпросмотр.')
        const layout = JSON.parse(measured.result.value)
        if (layout.viewport !== width || layout.document > width || layout.stage.left < 0 || layout.stage.right > width + 1 ||
          layout.message.left < layout.stage.left || layout.message.right > layout.stage.right + 1 ||
          layout.primary && layout.primary.scroll > layout.primary.client + 1) {
          throw new Error(`Telegram preview overflow at ${width}px (${mode}): ${JSON.stringify(layout)}`)
        }
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
        writeFileSync(join(screenshotDir, `telegram-preview-${width}-${mode}.png`), Buffer.from(shot.data, 'base64'))
        console.log(`${width}px / ${mode}: document=${layout.document}px, message=${Math.round(layout.message.width)}px, title=${layout.headline}`)
      }
    }
    if (externalRequests.length) throw new Error(`Предпросмотр вызвал внешние запросы: ${externalRequests.join(', ')}`)
    console.log(`Screenshots saved in ${screenshotDir}; no external requests observed.`)
  } finally { socket.close() }
} finally {
  browser.kill()
  vite.kill()
  await delay(300)
  rmSync(profile, { recursive: true, force: true })
}
