/** Mobile screenshot and geometry regression for the existing variant/problem hierarchy.
 * @see ../docs/product/design-system.md#cards-and-status
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const css = ['src/DayPage.css', 'src/components/ProblemCard.css', 'src/components/ParentTaskGuide.css', 'src/components/RequirementSwitch.css']
  .map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n')
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => path && existsSync(path))
if (!chrome) throw new Error('Для проверки нужен Chrome или CHROME_BIN.')

const card = (number, title, status) => `<details class="problem-card ready"><summary class="problem-card-heading"><strong>№ ${number}. ${title}</strong><span class="problem-card-state" aria-label="${status}"><small>${status}</small><svg class="problem-card-chevron" width="17" height="17" viewBox="0 0 17 17"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor"/></svg></span></summary><div class="day-parent-guide-body"><p>Условие задачи № ${number}</p><details class="day-parent-guide day-parent-learning-route"><summary class="day-learning-route-heading"><span><strong>Разбор для родителя</strong></span></summary><div class="day-parent-learning-route-body"><details class="day-learning-route-stage"><summary>Дано и что найти</summary><p>Подробности этапа</p></details></div></details></div></details>`
const variant = (number, cards) => `<div class="day-practice-variant-shell"><details class="day-practice-variant"><summary><strong>Вариант ${number}</strong><span>0 из ${cards.length}</span><svg width="17" height="17" viewBox="0 0 17 17"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor"/></svg></summary><div class="day-practice-variant-problems">${cards.join('')}</div></details><button class="edu-requirement-switch" role="switch" aria-checked="true" aria-label="Учитывать вариант"><span class="edu-requirement-switch-track"></span></button></div>`
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--edu-card-border:#ded6eb;--edu-radius-control:14px;--edu-surface:#fff;--edu-ink:#34295c;--edu-muted:#6a5d7d;--edu-touch-target:44px;--edu-canvas:#f7f4fb;--edu-control-border:#dcd3f2;--edu-brand:#7750e9}*{box-sizing:border-box}body{margin:0;padding:12px;background:#f5f2fa;font:16px Arial,sans-serif;color:#34295c}.fixture{max-width:540px;margin:auto;padding:12px;border:1px solid #ded6eb;border-radius:18px;background:#fff}.fixture>h1{font-size:1rem}.fixture-grid{display:grid;gap:10px}.day-parent-guide-body{padding:10px}${css}</style><div class="fixture"><h1>Пример · подготовка по математике</h1><div class="fixture-grid">${variant(1, [card(1, 'Марки Ивана', 'Не начато'), card(2, 'День и ночь', 'Не начато'), card(3, 'Океаны на диаграмме', 'Не начато')])}${variant(2, [card(1, 'Круговая диаграмма и распределение значений', 'Не начато')])}</div></div></html>`

const profile = mkdtempSync(join(tmpdir(), 'education-variant-viewport-'))
const fixturePath = join(profile, 'fixture.html')
writeFileSync(fixturePath, html)
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
  const socket = new WebSocket(targets.find((entry) => entry.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let nextId = 0
  const pending = new Map()
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    const handler = pending.get(message.id)
    if (!handler) return
    pending.delete(message.id)
    if (message.error) handler.reject(new Error(JSON.stringify(message.error)))
    else handler.resolve(message.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  try {
    for (const width of [320, 390, 540]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
      await send('Page.navigate', { url: `file://${fixturePath}` })
      await delay(150)
      const closed = await evaluate("[...document.querySelectorAll('.day-practice-variant,.problem-card,.day-parent-learning-route')].every(item=>!item.open)")
      if (!closed) throw new Error(`${width}px: вариант, задача или родительский разбор открыты до нажатия`)
      if (width === 390) {
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_COLLAPSED_SCREENSHOT_PATH ?? join(tmpdir(), 'education-variants-collapsed.png'), Buffer.from(shot.data, 'base64'))
      }
      await evaluate("document.querySelector('.day-practice-variant').open=true")
      const problemsClosed = await evaluate("[...document.querySelectorAll('.problem-card')].every(item=>!item.open)")
      if (!problemsClosed) throw new Error(`${width}px: вариант раскрывает задачи сам`)
      const metrics = JSON.parse(await evaluate("JSON.stringify({overflow:document.documentElement.scrollWidth>innerWidth,statuses:[...document.querySelectorAll('.problem-card-state')].map(el=>({height:el.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(el).lineHeight)||20,whiteSpace:getComputedStyle(el).whiteSpace}))})"))
      if (metrics.overflow || metrics.statuses.some((item) => item.whiteSpace !== 'nowrap' || item.height > item.lineHeight + 2)) throw new Error(`${width}px: статус переносится или карточка выходит за экран: ${JSON.stringify(metrics)}`)
      if (width === 390) {
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_EXPANDED_SCREENSHOT_PATH ?? join(tmpdir(), 'education-variant-expanded.png'), Buffer.from(shot.data, 'base64'))
      }
      console.log(`${width}px: варианты и задачи свёрнуты по умолчанию; статус в одной строке`)
    }
  } finally { socket.close() }
} finally {
  proc.kill()
  await delay(300)
  rmSync(profile, { recursive: true, force: true })
}
