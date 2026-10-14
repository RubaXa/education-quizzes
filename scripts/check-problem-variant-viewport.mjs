/** Mobile screenshot and geometry regression for the existing variant/problem hierarchy.
 * @see ../docs/product/design-system.md#cards-and-status
 * @see ../docs/product/problem-card-design-decisions.md
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const css = ['src/DayPage.css', 'src/components/ProblemCard.css', 'src/components/ProblemStatement.css', 'src/components/ParentTaskGuide.css', 'src/components/RequirementSwitch.css']
  .map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n')
const tokens = readFileSync(resolve(root, 'src/education-design-tokens.css'), 'utf8')
const iconCss = readFileSync(resolve(root, 'src/components/StatusIcon.css'), 'utf8')
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => path && existsSync(path))
if (!chrome) throw new Error('Для проверки нужен Chrome или CHROME_BIN.')

// @see ../docs/product/status-presentation.md#components — the fixture mirrors current ready SVG geometry.
const readyIcon = '<svg class="edu-status-icon edu-status-icon-ready" data-status="ready" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'
const statement = (number) => `<div class="problem-statement"><div class="problem-statement-original"><div class="problem-statement-label"><strong>Условие № ${number}</strong><button class="problem-statement-source-trigger unknown" aria-label="Происхождение не проверено. Показать происхождение задачи" aria-expanded="false"><svg data-status="unknown" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4"/><path d="M12 17h.01"/></svg></button></div><div class="problem-statement-source-detail" hidden><strong>Происхождение не проверено</strong><p>Исходный лист учителя известен. Поиск более раннего источника не записан.</p></div><div class="problem-statement-transcript"><div class="problem-statement-transcript-title">Условие текстом</div><div class="problem-statement-text"><b>№ ${number}.</b> Дано: DE = 6,4 см, EF = 3,9 см, DF = 9,3 см. Найти ошибку.</div></div></div><div class="problem-statement-education"><div class="problem-statement-label"><strong>Как читать условие</strong></div><div class="problem-statement-facts" aria-label="Дано"><div><small>DE</small><strong>6,4 см</strong></div><div><small>EF</small><strong>3,9 см</strong></div><div><small>DF</small><strong>9,3 см</strong></div></div><div class="problem-statement-find"><small>Найти</small><strong>Ошибку в условии</strong></div></div></div>`
const card = (number, title) => `<details class="problem-card ready"><summary class="problem-card-heading" aria-label="№ ${number}. ${title}. Не начато"><strong>№ ${number}. ${title}</strong><span class="problem-card-state">${readyIcon}<svg class="problem-card-chevron" width="17" height="17" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span></summary>${statement(number)}<details class="day-parent-guide day-parent-learning-route"><summary class="day-learning-route-heading"><span><strong>Разбор</strong></span></summary><div class="day-parent-learning-route-body"><details class="day-learning-route-stage"><summary>Дано и что найти</summary><p>Подробности этапа</p></details></div></details></details>`
const variant = (number, cards) => `<div class="day-practice-variant-shell"><details class="day-practice-variant"><summary><strong>Вариант ${number}</strong><span>${readyIcon}0 из ${cards.length}</span><svg class="day-practice-variant-chevron" width="17" height="17" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></summary><div class="day-practice-variant-problems">${cards.join('')}</div></details><button class="edu-requirement-switch" role="switch" aria-checked="true" aria-label="Учитывать вариант"><span class="edu-requirement-switch-track"></span></button></div>`
const actionFixture = `<div class="action-fixture day-parent-guide day-parent-learning-route" style="width:min(240px,100%);margin:0 auto 14px"><div class="day-parent-learning-route-body"><div class="day-learning-route-stage"><div class="day-learning-route-body"><div class="day-learning-route-actions"><button>Подсказка</button><button>Весь шаг</button></div></div></div></div></div>`
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${tokens}${iconCss}*{box-sizing:border-box}body{margin:0;padding:12px;background:#f5f2fa;font:16px Arial,sans-serif;color:#34295c}.fixture{max-width:540px;margin:auto;padding:12px;border:1px solid #ded6eb;border-radius:18px;background:#fff}.fixture>h1{font-size:1rem}.fixture-grid{display:grid;gap:10px}.day-parent-guide-body{padding:10px}${css}</style>${actionFixture}<div class="fixture"><h1>Пример интерфейса · подготовка по математике</h1><div class="fixture-grid">${variant(1, [card(1, 'Найти ошибку в длине отрезка'), card(2, 'День и ночь'), card(3, 'Океаны на диаграмме')])}${variant(2, [card(1, 'Круговая диаграмма и распределение значений')])}</div></div></html>`

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
      const actions = JSON.parse(await evaluate("JSON.stringify([...document.querySelectorAll('.action-fixture .day-learning-route-actions button')].map(el=>({top:el.getBoundingClientRect().top,width:el.clientWidth,scrollWidth:el.scrollWidth,whiteSpace:getComputedStyle(el).whiteSpace,fontSize:parseFloat(getComputedStyle(el).fontSize)})))"))
      if (actions.length !== 2 || Math.abs(actions[0].top - actions[1].top) > 1 || actions.some((item) => item.scrollWidth > item.width + 1 || item.whiteSpace !== 'nowrap' || item.fontSize < 12)) throw new Error(`${width}px: кнопки помощи не помещаются в одну строку с читаемым шрифтом: ${JSON.stringify(actions)}`)
      if (width === 320 && process.env.VARIANT_ACTIONS_SCREENSHOT_PATH) {
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_ACTIONS_SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'))
      }
      const closed = await evaluate("[...document.querySelectorAll('.day-practice-variant,.problem-card,.day-parent-learning-route')].every(item=>!item.open)")
      if (!closed) throw new Error(`${width}px: вариант, задача или родительский разбор открыты до нажатия`)
      if (width === 390) {
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_COLLAPSED_SCREENSHOT_PATH ?? join(tmpdir(), 'education-variants-collapsed.png'), Buffer.from(shot.data, 'base64'))
      }
      await evaluate("document.querySelector('.day-practice-variant').open=true")
      const problemsClosed = await evaluate("[...document.querySelectorAll('.problem-card')].every(item=>!item.open)")
      if (!problemsClosed) throw new Error(`${width}px: вариант раскрывает задачи сам`)
      const readyTextHidden = await evaluate("[...document.querySelectorAll('.problem-card > summary')].every(item=>!item.textContent.includes('Не начато') && item.getAttribute('aria-label').includes('Не начато'))")
      if (!readyTextHidden) throw new Error(`${width}px: повтор «Не начато» виден в компактных строках или потерян для скринридера`)
      const metrics = JSON.parse(await evaluate("JSON.stringify({overflow:document.documentElement.scrollWidth>innerWidth,statuses:[...document.querySelectorAll('.problem-card-state')].map(el=>({height:el.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(el).lineHeight)||20,whiteSpace:getComputedStyle(el).whiteSpace}))})"))
      if (metrics.overflow || metrics.statuses.some((item) => item.whiteSpace !== 'nowrap' || item.height > item.lineHeight + 2)) throw new Error(`${width}px: статус переносится или карточка выходит за экран: ${JSON.stringify(metrics)}`)
      if (width === 390) {
        await delay(250)
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_EXPANDED_SCREENSHOT_PATH ?? join(tmpdir(), 'education-variant-expanded.png'), Buffer.from(shot.data, 'base64'))
      }
      await evaluate("document.querySelector('.day-practice-variant .problem-card').open=true")
      const statementLayers = await evaluate("Boolean(document.querySelector('.day-practice-variant .problem-card .problem-statement-transcript') && document.querySelector('.day-practice-variant .problem-card .problem-statement-facts') && document.querySelector('.day-practice-variant .problem-card .problem-statement-find'))")
      if (!statementLayers) throw new Error(`${width}px: пропал структурированный слой условия`)
      const provenanceCompact = await evaluate("document.querySelector('.day-practice-variant .problem-card .problem-statement-source-trigger').getBoundingClientRect().width <= 44 && document.querySelector('.day-practice-variant .problem-card .problem-statement-source-detail').hidden")
      if (!provenanceCompact) throw new Error(`${width}px: происхождение опять занимает широкую полосу`)
      const guideClosed = await evaluate("[...document.querySelectorAll('.day-parent-learning-route')].every(item=>!item.open)")
      if (!guideClosed) throw new Error(`${width}px: открытие задачи самовольно раскрывает родительский разбор`)
      if (width === 390) {
        await delay(250)
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_PROBLEM_EXPANDED_SCREENSHOT_PATH ?? join(tmpdir(), 'education-problem-expanded.png'), Buffer.from(shot.data, 'base64'))
      }
      await evaluate("document.querySelector('.day-practice-variant .problem-card .problem-statement-source-detail').hidden=false")
      if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error(`${width}px: раскрытое происхождение выходит за экран`)
      if (width === 390 && process.env.VARIANT_SOURCE_EXPANDED_SCREENSHOT_PATH) {
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_SOURCE_EXPANDED_SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'))
      }
      await evaluate("document.querySelector('.day-practice-variant .problem-card .problem-statement-source-detail').hidden=true")
      await evaluate("document.querySelector('.day-practice-variant .day-parent-learning-route').open=true")
      const stagesClosed = await evaluate("[...document.querySelectorAll('.day-learning-route-stage')].every(item=>!item.open)")
      if (!stagesClosed) throw new Error(`${width}px: открытие родительского разбора самовольно раскрывает этапы`)
      const nestedOverflow = await evaluate('document.documentElement.scrollWidth>innerWidth')
      if (nestedOverflow) throw new Error(`${width}px: раскрытая вложенная карточка выходит за экран`)
      if (width === 390) {
        await delay(250)
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_GUIDE_EXPANDED_SCREENSHOT_PATH ?? join(tmpdir(), 'education-guide-expanded.png'), Buffer.from(shot.data, 'base64'))
      }
      console.log(`${width}px: варианты и задачи свёрнуты; статус и обе кнопки помощи в одной строке`)
    }
  } finally { socket.close() }
} finally {
  proc.kill()
  await delay(300)
  rmSync(profile, { recursive: true, force: true })
}
