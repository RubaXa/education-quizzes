/** Browser geometry regression for the mobile bell. Run where Chrome is available.
 * @see ../docs/shared/design/README.md#shell
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const css = ['src/App.css', 'src/components/NotificationBell.css', 'src/components/PwaControls.css']
  .map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n')
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => path && existsSync(path))
if (!chrome) throw new Error('Для проверки нужен Chrome или CHROME_BIN.')

function fixture(installed) {
  const install = installed ? '' : '<button class="pwa-install" aria-label="На экран телефона"><svg width="16" height="16"></svg><span>На экран телефона</span></button>'
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n:root{--edu-touch-target:42px}body{margin:0}</style>
    <div class="app-shell"><header class="site-header"><a class="brand"><span class="brand-mark">✳</span><span class="brand-long">Учусь и проверяю</span><span class="brand-short">Education</span></a>
    <div id="day-header-return"></div><div class="notification-bell-slot"><div class="notification-center"><button class="notification-bell">♧</button>
    <section class="notification-panel"><header><h2>Обновления</h2><button class="notification-read-all">Прочитать все</button><button class="notification-close">×</button></header><p>Новых обновлений нет.</p></section></div></div>
    <div class="header-actions"><span class="header-note">Маленькие шаги. Большой прогресс.</span>${install}</div></header></div>`
}

const profile = mkdtempSync(join(tmpdir(), 'education-bell-chrome-'))
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
    data.error ? handlers.reject(new Error(JSON.stringify(data.error))) : handlers.resolve(data.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  try {
    for (const width of [320, 390, 540, 640]) for (const installed of [true, false]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
      await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(fixture(installed)).toString('base64')}` })
      await delay(250)
      const result = await send('Runtime.evaluate', { returnByValue: true,
        expression: `JSON.stringify((()=>{const b=document.querySelector('.notification-bell').getBoundingClientRect(),p=document.querySelector('.notification-panel').getBoundingClientRect(),h=document.querySelector('.notification-panel header'),a=document.querySelector('.notification-read-all').getBoundingClientRect(),c=document.querySelector('.notification-close').getBoundingClientRect(),s=getComputedStyle(document.querySelector('.notification-read-all'));return{width:innerWidth,visual:visualViewport.width,scroll:document.documentElement.scrollWidth,note:getComputedStyle(document.querySelector('.header-note')).display,brand:document.querySelector('.brand').getBoundingClientRect().width,actions:document.querySelector('.header-actions').getBoundingClientRect().width,bellRight:b.right,panelLeft:p.left,panelRight:p.right,headerWidth:h.clientWidth,headerScroll:h.scrollWidth,actionLeft:a.left,actionRight:a.right,actionFont:s.fontSize,actionPadding:s.padding,closeLeft:c.left}})())` })
      if (result.exceptionDetails || !result.result?.value) throw new Error('Chrome не смог измерить панель.')
      const row = JSON.parse(result.result.value)
      if (row.width !== width || row.bellRight < width - 24 || row.bellRight > width - 12 ||
        row.panelLeft < 12 || row.panelRight > width - 12 || row.headerScroll > row.headerWidth ||
        row.actionLeft < row.panelLeft || row.actionRight > row.closeLeft) throw new Error(`Панель вышла за границы: ${JSON.stringify({ ...row, installed })}`)
      console.log(`${width}px, ${installed ? 'PWA установлена' : 'до установки'}: bell=${row.bellRight}, panel=${row.panelLeft}..${row.panelRight}`)
    }
  } finally { socket.close() }
} finally { proc.kill(); await delay(300); rmSync(profile, { recursive: true, force: true }) }
