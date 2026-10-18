/** Browser regression for the Telegram UI Kit at mobile and narrow desktop widths.
 * Run with: node scripts/check-telegram-preview-viewport.mjs
 * @see ../docs/shared/design/telegram.md#компактная-сводка
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
      await send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{const select=document.querySelector('select[aria-label="Шаблон уведомления"]');if(!select)throw Error('template selector missing');select.value='review';select.dispatchEvent(new Event('change',{bubbles:true}))})()` })
      await delay(100)

      for (const mode of ['short', 'long', 'no-context']) {
        const changed = await send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{const select=document.querySelector('select[aria-label="Содержание уведомления"]');if(!select)throw Error('content selector missing');select.value=${JSON.stringify(mode)};select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));return true})()` })
        if (!changed.result?.value) throw new Error(`Could not switch preview to ${mode}`)
        await delay(120)
        const measured = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify((()=>{const stage=document.querySelector('.edu-telegram-stage'),message=document.querySelector('.edu-telegram-message'),text=document.querySelector('.edu-telegram-message-text'),header=document.querySelector('.edu-telegram-message-header'),empty=document.querySelector('.edu-telegram-no-message');const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width,height:r.height,scroll:e.scrollWidth,client:e.clientWidth}};const style=text?getComputedStyle(text):null;return{viewport:innerWidth,document:document.documentElement.scrollWidth,stage:rect(stage),message:rect(message),text:rect(text),empty:empty?.textContent??null,content:text?.textContent??null,lines:text?.textContent.split('\\n').length??0,fontSize:style?.fontSize,fontWeight:style?.fontWeight,headerWeight:header?getComputedStyle(header).fontWeight:null,overflowWrap:style?.overflowWrap}})())` })
        if (measured.exceptionDetails || !measured.result?.value) throw new Error('Chrome не смог измерить предпросмотр.')
        const layout = JSON.parse(measured.result.value)
        if (layout.viewport !== width || layout.document > width || layout.stage.left < 0 || layout.stage.right > width + 1 ||
          mode === 'no-context' && (layout.message !== null || !layout.empty) ||
          mode !== 'no-context' && (!layout.message || layout.message.left < layout.stage.left || layout.message.right > layout.stage.right + 1 || layout.text.scroll > layout.text.client + 1)) {
          throw new Error(`Telegram preview overflow at ${width}px (${mode}): ${JSON.stringify(layout)}`)
        }
        if (mode === 'short' && width >= 390 && layout.message.height > 200) throw new Error(`Short digest is too tall at ${width}px: ${JSON.stringify(layout)}`)
        if (mode === 'short' && width === 320 && layout.message.height > 240) throw new Error(`Short digest exceeds the narrow-screen height budget: ${JSON.stringify(layout)}`)
        if (mode === 'short' && (layout.lines !== 4 || !layout.content.includes('№3 · Шестьдесят горшков') || !layout.content.includes('№1 · Книги на полках'))) {
          throw new Error(`Short digest lost its task rows: ${JSON.stringify(layout)}`)
        }
        if (mode === 'long' && (!layout.content.includes('обратным действием') || !layout.content.includes('демонстрационное имя') || layout.overflowWrap !== 'anywhere')) {
          throw new Error(`Long digest did not retain and wrap its content: ${JSON.stringify(layout)}`)
        }
        if (mode !== 'no-context' && (Number.parseFloat(layout.fontSize) < 16 || Number.parseFloat(layout.fontSize) > 17 || Number(layout.fontWeight) !== 400 || Number(layout.headerWeight) < 600)) {
          throw new Error(`Digest must use normal 16–17px text with a compact bold header: ${JSON.stringify(layout)}`)
        }
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
        writeFileSync(join(screenshotDir, `telegram-preview-${width}-${mode}.png`), Buffer.from(shot.data, 'base64'))
        console.log(`${width}px / ${mode}: document=${layout.document}px, message=${layout.message ? `${Math.round(layout.message.width)}×${Math.round(layout.message.height)}px` : 'omitted'}, lines=${layout.lines}`)
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
