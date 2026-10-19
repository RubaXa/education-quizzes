/** Mobile screenshot and geometry regression for the existing variant/problem hierarchy.
 * @see ../docs/shared/design/README.md#cards-and-status
 * @see ../docs/modules/reviews/problem-card-design-decisions.md
 * @see ../docs/decisions/released-stage-parity-2026-10-20.md
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const css = ['src/DayPage.css', 'src/components/ProblemGroup.css', 'src/components/AssignmentBrief.css', 'src/components/ProblemCard.css', 'src/components/ProblemStatement.css', 'src/components/SourceFragment.css', 'src/components/EducationImage.css', 'src/components/ParentTaskGuide.css', 'src/components/TaskGuidance.css', 'src/components/RequirementSwitch.css']
  .map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n')
const tokens = readFileSync(resolve(root, 'src/education-design-tokens.css'), 'utf8')
const iconCss = readFileSync(resolve(root, 'src/components/StatusIcon.css'), 'utf8')
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => path && existsSync(path))
if (!chrome) throw new Error('Для проверки нужен Chrome или CHROME_BIN.')

// @see ../docs/shared/design/statuses.md#components — the fixture mirrors current ready SVG geometry.
const readyIcon = '<svg class="edu-status-icon edu-status-icon-ready" data-status="ready" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'
const originalImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1871" height="1323"><rect width="100%" height="100%" fill="white"/><text x="95" y="160" font-size="27" font-family="serif">3. Дано: DE = 6,4 см; EF = 3,9 см; DF = 9,3 см.</text><text x="95" y="198" font-size="27" font-family="serif">Найти ошибку в условии.</text></svg>')}`
const releaseExample = `<section class="guidance-parity-fixture"><details class="day-parent-guide day-parent-learning-route" open><summary class="day-learning-route-heading"><strong>Родитель · preview</strong></summary><div class="day-parent-learning-route-body"><details class="day-learning-route-stage" open><summary><span class="day-learning-route-stage-title"><b>Прямая и направления</b></span></summary><div class="day-learning-route-body"><p>Переходы ±1, ±2, ±4, ±8, ±16 дм</p><div class="day-learning-route-rows day-learning-route-rows-calculation"><div><div><small>Симметрия</small><strong>Можно считать последний переход равным +16</strong></div></div></div><p class="day-learning-route-why">Почему: Парные переходы равны по длине и направлены в противоположные стороны.</p><small class="day-learning-route-source">Источник: Лист учителя №2</small><div class="day-learning-route-preview"><b>Показать Пете</b><p>Учитывай направление каждого перехода: равные по длине отрезки могут иметь разные знаки.</p><button>Отправить Пете</button></div></div></details></div></details><details class="day-task-guidance day-parent-guide day-parent-learning-route" open><summary class="day-learning-route-heading"><strong>Ученик · reveal</strong></summary><div class="day-parent-learning-route-body"><details class="day-learning-route-stage" open><summary><span class="day-learning-route-stage-title"><b>Прямая и направления</b><small>Показанный шаг</small></span></summary><div class="day-learning-route-body"><p>Переходы ±1, ±2, ±4, ±8, ±16 дм</p><div class="day-learning-route-rows day-learning-route-rows-calculation"><div><div><small>Симметрия</small><strong>Можно считать последний переход равным +16</strong></div></div></div><p class="day-learning-route-why">Почему: Парные переходы равны по длине и направлены в противоположные стороны.</p><small class="day-learning-route-source">Источник: Лист учителя №2</small><p>Учитывай направление каждого перехода: равные по длине отрезки могут иметь разные знаки.</p></div></details></div></details></section>`
const statement = (number) => `<div class="problem-statement"><div class="problem-statement-original"><div class="source-fragment"><button class="source-fragment-trigger"><span class="source-fragment-caption"><strong>Оригинал учителя</strong><small>Открыть крупно ↗</small></span><span class="education-image education-image-crop" data-state="ready" style="aspect-ratio:820 / 128;--edu-crop-width:228.1707%;--edu-crop-left:-10.9756%;--edu-crop-top:-101.5625%;--edu-image-fit:contain"><img src="${originalImage}" alt="Точный фрагмент листа учителя"/></span></button></div><div class="problem-statement-transcript"><div class="problem-statement-transcript-title">Условие текстом</div><div class="problem-statement-text"><b>№ ${number}.</b> Дано: DE = 6,4 см, EF = 3,9 см, DF = 9,3 см. Найти ошибку.</div></div></div><div class="problem-statement-education"><div class="problem-statement-facts" aria-label="Дано"><div><strong>6,4 см</strong><small>DE</small></div><div><strong>3,9 см</strong><small>EF</small></div><div><strong>9,3 см</strong><small>DF</small></div></div><div class="problem-statement-find"><small>Найти</small><strong>Ошибку в условии</strong></div></div></div>`
const card = (number, title) => `<details class="problem-card ready"><summary class="problem-card-heading" aria-label="№ ${number}. ${title}. Не начато"><strong>№ ${number}. ${title}</strong><span class="problem-card-state">${readyIcon}</span><span class="problem-card-source-wrap"><button class="problem-card-source-trigger unknown" aria-label="Происхождение не проверено. Показать происхождение задачи" aria-expanded="false"><svg data-status="unknown" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4"/><path d="M12 17h.01"/></svg></button></span><svg class="problem-card-chevron" width="17" height="17" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span class="problem-card-source-detail" hidden>Исходный лист известен. Поиск более раннего источника не записан.</span></summary>${statement(number)}<details class="day-parent-guide day-parent-learning-route"><summary class="day-learning-route-heading"><span><strong>Разбор для родителя</strong></span></summary><div class="day-parent-learning-route-body"><details class="day-learning-route-stage"><summary>Дано и что найти</summary><p>Подробности этапа</p></details></div></details></details>`
const variant = (number, cards) => `<div class="day-practice-variant-shell"><details class="day-practice-variant"><summary><strong>Вариант ${number}</strong><span>${readyIcon}0 из ${cards.length}</span><svg class="day-practice-variant-chevron" width="17" height="17" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></summary><div class="day-practice-variant-problems">${cards.join('')}</div></details><button class="edu-requirement-switch" role="switch" aria-checked="true" aria-label="Учитывать вариант"><span class="edu-requirement-switch-track"></span></button></div>`
const actionFixture = `<div class="action-fixture day-parent-guide day-parent-learning-route" style="width:min(240px,100%);margin:0 auto 14px"><div class="day-parent-learning-route-body"><div class="day-learning-route-stage"><div class="day-learning-route-body"><div class="day-learning-route-actions"><button>Подсказка</button><button>Весь шаг</button></div></div></div></div></div>`
const diagramFacts = `<div class="diagram-fact-fixture fixture day-subject has-numbered-sheet"><div class="problem-statement-education"><div class="problem-statement-facts" aria-label="Дано"><div><strong>20</strong><small>Птицы</small></div><div><strong>10</strong><small>Животные</small></div><div><strong>60</strong><small>Автомобили</small></div></div><div class="problem-statement-find"><small>Найти</small><strong>Построить круговую диаграмму коллекции</strong></div></div></div>`
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${tokens}${iconCss}*{box-sizing:border-box}body{margin:0;padding:12px;background:#f5f2fa;font:16px Arial,sans-serif;color:#34295c}.fixture{max-width:540px;margin:auto}.fixture-grid{display:grid;gap:0}.day-parent-guide-body{padding:10px}${css}</style>${actionFixture}${diagramFacts}<section class="fixture day-subject has-numbered-sheet"><div class="day-subject-head"><span class="day-subject-icon">∑</span><div class="day-subject-title"><h2>Математика</h2></div><button class="day-subject-toggle">⌃</button><div class="day-subject-status"><span class="day-subject-assignment-count">0 из 4</span></div></div><div class="day-subject-content"><section class="problem-group"><button class="problem-group-toggle" aria-expanded="false" aria-label="Развернуть подготовку к самостоятельной; 0 из 4 завершено"><span class="problem-group-top"><strong>Подготовка: диаграммы</strong><span class="problem-group-badge">0 из 4</span><svg class="problem-group-chevron" width="18" height="18" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"/></svg></span><span class="problem-group-subtitle">Самопроверка · 2 варианта</span></button><div class="problem-group-body" hidden><article class="day-task has-problems"><details class="day-teacher-sheet"><summary><span>▤ Лист учителя</span><span>1 лист · открыть ↗</span></summary><div class="day-assignment-brief day-assignment-brief-compact">Подготовиться по двум вариантам листа</div></details><div class="day-problem-list"><h4 class="edu-visually-hidden">Задания из листа · 4</h4><div class="fixture-grid">${variant(1, [card(1, 'Найти ошибку в длине отрезка'), card(2, 'День и ночь'), card(3, 'Океаны на диаграмме')])}${variant(2, [card(1, 'Круговая диаграмма и распределение значений')])}</div></div></article></div></section></div></section></html>`

const profile = mkdtempSync(join(tmpdir(), 'education-variant-viewport-'))
const fixturePath = join(profile, 'fixture.html')
writeFileSync(fixturePath, html)
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
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
      const factTiles = JSON.parse(await evaluate("JSON.stringify([...document.querySelectorAll('.diagram-fact-fixture .problem-statement-facts>div')].map(el=>({label:el.querySelector('small').textContent,value:el.querySelector('strong').textContent,background:getComputedStyle(el).backgroundColor,width:el.getBoundingClientRect().width,scrollWidth:el.scrollWidth})))"))
      if (factTiles.length !== 3 || factTiles.some((tile) => tile.background === 'rgba(0, 0, 0, 0)' || tile.scrollWidth > tile.width + 1)) throw new Error(`${width}px: отдельные ячейки данных потеряны или переполнены: ${JSON.stringify(factTiles)}`)
      if (width === 390 && process.env.VARIANT_FACTS_SCREENSHOT_PATH) {
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_FACTS_SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'))
      }
      const actions = JSON.parse(await evaluate("JSON.stringify([...document.querySelectorAll('.action-fixture .day-learning-route-actions button')].map(el=>({top:el.getBoundingClientRect().top,width:el.clientWidth,scrollWidth:el.scrollWidth,whiteSpace:getComputedStyle(el).whiteSpace,fontSize:parseFloat(getComputedStyle(el).fontSize)})))"))
      if (actions.length !== 2 || Math.abs(actions[0].top - actions[1].top) > 1 || actions.some((item) => item.scrollWidth > item.width + 1 || item.whiteSpace !== 'nowrap' || item.fontSize < 12)) throw new Error(`${width}px: кнопки помощи не помещаются в одну строку с читаемым шрифтом: ${JSON.stringify(actions)}`)
      if (width === 320 && process.env.VARIANT_ACTIONS_SCREENSHOT_PATH) {
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_ACTIONS_SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'))
      }
      const closed = await evaluate("[...document.querySelectorAll('.day-practice-variant,.problem-card,.day-parent-learning-route')].every(item=>!item.open)")
      if (!closed) throw new Error(`${width}px: вариант, задача или родительский разбор открыты до нажатия`)
      if (!await evaluate("document.querySelector('.problem-group-body').hidden && document.querySelector('.problem-group-toggle').getAttribute('aria-expanded')==='false'")) throw new Error(`${width}px: лист должен быть закрыт при входе`)
      if (width === 390 && process.env.VARIANT_SHEET_COLLAPSED_SCREENSHOT_PATH) {
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_SHEET_COLLAPSED_SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'))
      }
      await evaluate("document.querySelector('.problem-group-body').hidden=false;document.querySelector('.problem-group-toggle').setAttribute('aria-expanded','true')")
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
      const sourcePixels = await evaluate("(() => { const image=document.querySelector('.day-practice-variant .problem-card .source-fragment .education-image-crop>img'); const box=image?.closest('.education-image-crop')?.getBoundingClientRect(); return Boolean(image?.complete && image.naturalWidth===1871 && box && box.width>0 && box.height>0 && box.height<box.width/3) })()")
      if (!sourcePixels) throw new Error(`${width}px: видимый фрагмент оригинала не загрузился или имеет неверную геометрию`)
      // @see ../docs/modules/reviews/problem-card-design-decisions.md#flat-numbered-sheet
      const nestedFrames = JSON.parse(await evaluate("JSON.stringify(['.problem-group','.day-task.has-problems','.day-practice-variant','.problem-card','.problem-statement','.problem-statement-transcript'].map(selector=>({selector,left:parseFloat(getComputedStyle(document.querySelector(selector)).borderLeftWidth)})))"))
      if (nestedFrames.some((item) => item.left > 0)) throw new Error(`${width}px: лишняя рамка вокруг вложенного слоя: ${JSON.stringify(nestedFrames)}`)
      const statementLayers = await evaluate("Boolean(document.querySelector('.day-practice-variant .problem-card .problem-statement-transcript') && document.querySelector('.day-practice-variant .problem-card .problem-statement-facts') && document.querySelector('.day-practice-variant .problem-card .problem-statement-find'))")
      if (!statementLayers) throw new Error(`${width}px: пропал структурированный слой условия`)
      const provenanceWidth = await evaluate("document.querySelector('.day-practice-variant .problem-card .problem-card-source-trigger').getBoundingClientRect().width")
      const provenanceCompact = provenanceWidth <= 48 && await evaluate("document.querySelector('.day-practice-variant .problem-card .problem-card-source-trigger').closest('summary')!==null && document.querySelector('.day-practice-variant .problem-card .problem-card-source-detail').hidden")
      if (!provenanceCompact) throw new Error(`${width}px: происхождение опять занимает широкую полосу (${provenanceWidth}px)`)
      const guideClosed = await evaluate("[...document.querySelectorAll('.day-parent-learning-route')].every(item=>!item.open)")
      if (!guideClosed) throw new Error(`${width}px: открытие задачи самовольно раскрывает родительский разбор`)
      if (width === 390) {
        await delay(250)
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_PROBLEM_EXPANDED_SCREENSHOT_PATH ?? join(tmpdir(), 'education-problem-expanded.png'), Buffer.from(shot.data, 'base64'))
      }
      await evaluate("document.querySelector('.day-practice-variant .problem-card .problem-card-source-detail').hidden=false")
      if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error(`${width}px: раскрытое происхождение выходит за экран`)
      if (width === 390 && process.env.VARIANT_SOURCE_EXPANDED_SCREENSHOT_PATH) {
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_SOURCE_EXPANDED_SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'))
      }
      await evaluate("document.querySelector('.day-practice-variant .problem-card .problem-card-source-detail').hidden=true")
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
      await evaluate(`document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(releaseExample)})`)
      const releaseDisclosure = JSON.parse(await evaluate("JSON.stringify((() => { const root=document.querySelector('.guidance-parity-fixture'); root.querySelectorAll('details').forEach(node=>node.open=true); return {overflow:document.documentElement.scrollWidth>innerWidth, titles:[...root.querySelectorAll('.day-learning-route-stage-title b')].map(node=>node.textContent), expected:root.textContent.includes('Переходы ±1, ±2, ±4, ±8, ±16 дм'), row:root.textContent.includes('Можно считать последний переход равным +16'), source:root.textContent.includes('Лист учителя №2'), private:root.textContent.includes('private-ref') || root.textContent.includes('private-excerpt')} })())"))
      if (releaseDisclosure.overflow || releaseDisclosure.titles.length !== 2 || releaseDisclosure.titles.some((title) => title !== 'Прямая и направления') || !releaseDisclosure.expected || !releaseDisclosure.row || !releaseDisclosure.source || releaseDisclosure.private) throw new Error(`${width}px: parity выбранного этапа нарушена: ${JSON.stringify(releaseDisclosure)}`)
      if (width === 390 && process.env.VARIANT_GUIDANCE_PARITY_SCREENSHOT_PATH) {
        const shot = await send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(process.env.VARIANT_GUIDANCE_PARITY_SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'))
      }
      console.log(`${width}px: варианты и задачи свёрнуты; статус и обе кнопки помощи в одной строке`)
    }
  } finally { socket.close() }
} finally {
  proc.kill()
  await delay(300)
  rmSync(profile, { recursive: true, force: true })
}
