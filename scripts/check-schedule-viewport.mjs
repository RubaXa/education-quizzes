/** Browser geometry regression for compact schedule rows.
 * @see ../docs/product/design-system.md#mobile-card-headings
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const css = readFileSync(resolve(root, 'src/DayDashboard.css'), 'utf8')
const tokens = readFileSync(resolve(root, 'src/education-design-tokens.css'), 'utf8')
const iconCss = readFileSync(resolve(root, 'src/components/StatusIcon.css'), 'utf8')
const fontRoot = resolve(root, 'node_modules/@fontsource-variable/geist/files')
const cyrillicFont = readFileSync(join(fontRoot, 'geist-cyrillic-wght-normal.woff2')).toString('base64')
const latinFont = readFileSync(join(fontRoot, 'geist-latin-wght-normal.woff2')).toString('base64')
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => path && existsSync(path))
if (!chrome) throw new Error('Для проверки нужен Chrome или CHROME_BIN.')

const rows = [
  ['Биология', '1 из 1', 'complete', 'Прошёл'], ['История', '1 из 1', 'complete has-new-homework', 'Идёт'],
  ['Русский язык', '1 из 2', 'partial'], ['Математика', 'ДЗ 12.10', 'unknown'],
  ['Английский язык', '0 из 1', 'empty'], ['География', '1 из 1', 'complete'],
  ['Физическая культура', 'Не задано', 'none'],
]
const screenshotDir = process.env.SCHEDULE_SCREENSHOT_DIR
// @see ../docs/product/status-presentation.md#matrix — fixture mirrors the icon/count/chevron columns.
const statusIcon = (status) => {
  const path = status === 'complete' ? '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>'
    : status === 'partial' ? '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>'
      : status === 'unknown' ? '<circle cx="12" cy="12" r="10"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01"/>'
        : status === 'not-assigned' ? '<path d="M4 12h16"/>'
        : '<circle cx="12" cy="12" r="10"/>'
  return `<svg class="edu-status-icon edu-status-icon-${status}" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
}
const chevron = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>'
const newIcon = '<svg class="edu-status-icon edu-status-icon-new" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><circle cx="19" cy="5" r="2"/></svg>'
function fixture(open) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  @font-face{font-family:'Geist Variable';src:url(data:font/woff2;base64,${cyrillicFont}) format('woff2');font-weight:100 900;unicode-range:U+0400-052F,U+2DE0-2DFF,U+A640-A69F}
  @font-face{font-family:'Geist Variable';src:url(data:font/woff2;base64,${latinFont}) format('woff2');font-weight:100 900;unicode-range:U+0000-00FF}
  ${tokens}${iconCss}${css}\nbody{margin:0;padding:8px;font-family:'Geist Variable',sans-serif}</style>
  <div class="day-dashboard"><section class="day-dashboard-card"><ul class="day-dashboard-lessons">
  ${rows.map(([name, badge, tone, phase]) => `<li><details class="day-dashboard-lesson day-dashboard-lesson-${tone}" ${open ? 'open' : ''}>
    <summary><time>08:30</time><span class="day-dashboard-lesson-name">${name}${phase ? `<span class="day-dashboard-lesson-phase${phase === 'Идёт' ? ' current' : ''}">${phase}</span>` : ''}${name === 'История' ? `<span class="day-dashboard-lesson-new">${newIcon}Новое ДЗ</span>` : ''}</span>
    <span class="day-dashboard-lesson-badge">${badge.startsWith('ДЗ') ? '' : statusIcon(tone.includes('complete') ? 'complete' : tone === 'partial' ? 'partial' : tone === 'unknown' ? 'unknown' : tone === 'none' ? 'not-assigned' : 'ready')}${badge}${chevron}</span></summary>
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
      if (screenshotDir) {
        mkdirSync(screenshotDir, { recursive: true })
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
        writeFileSync(join(screenshotDir, `schedule-${width}-${open ? 'open' : 'compact'}.png`), Buffer.from(shot.data, 'base64'))
      }
      console.log(`${width}px, ${open ? 'раскрыто' : 'свёрнуто'}: ${layout.rows.length} компактных строк`)
    }
  } finally { socket.close() }
} finally { proc.kill(); await delay(300); rmSync(profile, { recursive: true, force: true }) }
