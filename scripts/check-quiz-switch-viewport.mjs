/** Real CSS geometry for the shared active-test header on a narrow phone.
 * @see ../docs/product/quizzes.md#optional-quiz
 * @see ../docs/product/quizzes.md#attempt-time */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((path) => path && existsSync(path))
if (!chrome) throw new Error('Для проверки шапки теста нужен Chrome или CHROME_BIN.')
const css = ['src/education-design-tokens.css', 'src/components/QuizCard.css', 'src/components/RequirementSwitch.css']
  .map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n')
const fixture = (parent) => `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#f6f5fc;font:16px Arial,sans-serif}.day-quiz-lineage{margin:12px;width:calc(100% - 24px)}${css}</style><section class="day-quiz-lineage"><div class="day-quiz-lineage-head"><strong>Самопроверка: Подготовиться к самостоятельной: диаграммы</strong><div class="day-quiz-lineage-meta"><span class="day-quiz-score-time"><span class="day-quiz-lineage-score"><svg width="14" height="14"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor"/></svg>0 из 20</span><button type="button" class="day-quiz-time-trigger" aria-label="Время теста"><svg width="17" height="17"><circle cx="8.5" cy="8.5" r="7" fill="none" stroke="currentColor"/></svg></button></span>${parent ? '<span class="day-quiz-requirement"><span>Обязателен</span><button type="button" class="edu-requirement-switch" role="switch" aria-checked="true" aria-label="Учитывать тест"><span class="edu-requirement-switch-track"></span></button></span>' : '<span class="day-quiz-optional-label">По желанию</span>'}</div></div></section></html>`

const profile = mkdtempSync(join(tmpdir(), 'education-quiz-switch-'))
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
try {
  let port
  for (let attempt = 0; attempt < 100; attempt++) {
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
  try {
    for (const width of [320, 390, 540]) for (const parent of [true, false]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
      await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(fixture(parent)).toString('base64')}` })
      await delay(150)
      const result = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify((()=>{const card=document.querySelector('.day-quiz-lineage'),meta=document.querySelector('.day-quiz-lineage-meta'),score=document.querySelector('.day-quiz-lineage-score'),clock=document.querySelector('.day-quiz-time-trigger'),right=document.querySelector('.day-quiz-requirement,.day-quiz-optional-label'),switcher=document.querySelector('.edu-requirement-switch');const s=score.getBoundingClientRect(),t=clock.getBoundingClientRect(),r=right.getBoundingClientRect(),m=meta.getBoundingClientRect(),c=card.getBoundingClientRect();return{scroll:document.documentElement.scrollWidth,cardRight:c.right,metaWidth:meta.clientWidth,metaScroll:meta.scrollWidth,scoreTop:s.top,clockTop:t.top,rightTop:r.top,rightHeight:r.height,scoreRight:s.right,clockLeft:t.left,clockRight:t.right,clockWidth:t.width,clockHeight:t.height,rightLeft:r.left,rightRight:r.right,labelWidth:right.querySelector('span')?.getBoundingClientRect().width,labelFont:getComputedStyle(right).fontSize,metaRight:m.right,switchWidth:switcher?.getBoundingClientRect().width,switchHeight:switcher?.getBoundingClientRect().height}})())` })
      if (result.exceptionDetails || !result.result?.value) throw new Error('Не удалось измерить карточку.')
      const row = JSON.parse(result.result.value)
      if (row.scroll > width || row.cardRight > width - 10 || row.metaScroll > row.metaWidth + 1 ||
        Math.abs(row.clockTop + row.clockHeight / 2 - row.rightTop - row.rightHeight / 2) > 3 || row.scoreRight > row.clockLeft || row.clockRight > row.rightLeft - 3 || row.rightRight > row.metaRight + 1 ||
        row.clockWidth < 42 || row.clockHeight < 42 ||
        parent && (row.switchWidth < 42 || row.switchHeight < 42)) {
        throw new Error(`${width}px ${parent ? 'родитель' : 'ребёнок'}: шапка теста переполнена или перенесена: ${JSON.stringify(row)}`)
      }
      console.log(`${width}px ${parent ? 'родитель' : 'ребёнок'}: статус и выбор в одной строке`)
    }
  } finally { socket.close() }
} finally { proc.kill(); await delay(300); rmSync(profile, { recursive: true, force: true }) }
