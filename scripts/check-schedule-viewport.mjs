/** Browser geometry regression for compact schedule rows.
 * @see ../docs/product/design-system.md#mobile-card-headings
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const css = readFileSync(resolve(root, 'src/DayDashboard.css'), 'utf8')
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => path && existsSync(path))
if (!chrome) throw new Error('Для проверки нужен Chrome или CHROME_BIN.')

const rows = [
  ['Биология', '1 из 1', 'complete'], ['История', '1 из 1', 'complete has-new-homework'],
  ['Русский язык', '1 из 2', 'partial'], ['Математика', 'См. 12 октября', 'unknown'],
  ['Английский язык', '0 из 1', 'empty'], ['География', '1 из 1', 'complete'],
]
function fixture(open) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nbody{margin:0;padding:8px}</style>
  <div class="day-dashboard"><section class="day-dashboard-card"><ul class="day-dashboard-lessons">
  ${rows.map(([name, badge, tone]) => `<li><details class="day-dashboard-lesson day-dashboard-lesson-${tone}" ${open ? 'open' : ''}>
    <summary><time>08:30</time><span class="day-dashboard-lesson-name">${name}${name === 'История' ? '<span class="day-dashboard-lesson-new">Новое ДЗ</span>' : ''}</span>
    <span class="day-dashboard-lesson-badge">${tone.includes('complete') ? '<svg width="13" height="13"></svg>' : ''}${badge}<svg width="15" height="15"></svg></span></summary>
    <div class="day-dashboard-lesson-body">Подробности задания и проверки.</div></details></li>`).join('')}
  </ul></section></div>`
}

const profile = mkdtempSync(join(tmpdir(), 'education-schedule-chrome-'))
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
    for (const width of [320, 390, 540]) for (const open of [false, true]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
      await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(fixture(open)).toString('base64')}` })
      await delay(160)
      const result = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify((()=>({
        width:innerWidth,scroll:document.documentElement.scrollWidth,
        rows:[...document.querySelectorAll('.day-dashboard-lesson summary')].map(s=>{const n=s.querySelector('.day-dashboard-lesson-name'),b=s.querySelector('.day-dashboard-lesson-badge'),nr=n.getBoundingClientRect(),br=b.getBoundingClientRect(),sr=s.getBoundingClientRect();return{name:n.textContent,badge:b.textContent,height:sr.height,nameLeft:nr.left,nameRight:nr.right,badgeLeft:br.left,badgeRight:br.right,centerGap:Math.abs((nr.top+nr.bottom-br.top-br.bottom)/2),nameFits:n.scrollWidth<=n.clientWidth,badgeFits:b.scrollWidth<=b.clientWidth}})
      }))())` })
      if (result.exceptionDetails || !result.result?.value) throw new Error('Chrome не смог измерить расписание.')
      const layout = JSON.parse(result.result.value)
      const bad = layout.rows.find((row) => row.badgeLeft < row.nameRight + 5 || row.centerGap > 7 || row.height > 70 || !row.nameFits || !row.badgeFits || row.badgeRight > width - 18)
      if (layout.width !== width || layout.scroll > width || bad) throw new Error(`Сетка урока нарушена: ${JSON.stringify({ width, open, bad, scroll: layout.scroll })}`)
      console.log(`${width}px, ${open ? 'раскрыто' : 'свёрнуто'}: ${layout.rows.length} компактных строк`)
    }
  } finally { socket.close() }
} finally { proc.kill(); await delay(300); rmSync(profile, { recursive: true, force: true }) }
