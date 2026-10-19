/** Browser geometry regression for compact schedule rows.
 * @see ../docs/shared/design/README.md#mobile-card-headings
 * @see ../docs/decisions/calendar-fixed-height-2026-10-19.md
 * @see ../docs/decisions/calendar-vacation-inset-2026-10-19.md
 * @see ../docs/decisions/calendar-vacation-sticky-2026-10-19.md
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

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
  ['Биология', '1 из 1', 'complete'], ['Практикум по решению математических задач', '⸻', 'none'],
  ['История', '1 из 1', 'complete has-new-homework', 'current'],
  ['Русский язык', '1 из 2', 'partial', 'waiting'], ['Математика', 'ДЗ 12.10', 'unknown'],
  ['Английский язык', '0 из 1', 'empty'], ['География', '1 из 1', 'complete'],
  ['Физическая культура', '⸻', 'none'],
]
const screenshotDir = process.env.SCHEDULE_SCREENSHOT_DIR
// Render the shipped calendar rather than duplicating its JSX in a fixture.
// @see ../docs/modules/school-diary/school-calendar.md#представление
const vite = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let calendarFixture
try {
  const { default: Calendar } = await vite.ssrLoadModule('/src/components/DayCalendar.tsx')
  const calendar = { schemaVersion: 1, source: 'mesh', from: '2026-09-01', to: '2027-08-31', revision: 'a'.repeat(64),
    checkedAt: '2026-10-19T00:00:00Z', vacations: [{ from: '2026-10-24', to: '2026-11-01', title: 'Каникулы · геометрический пример' }] }
  const days = Array.from({ length: 18 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 17 + i)).toISOString().slice(0, 10),
    complete: false, schedule: i % 3 ? [{ subject: 'Пример' }] : [], homework: i % 4 ? [] : [{ subject: 'Пример', text: 'Пример' }] }))
  const extendedDays = Array.from({ length: 90 }, (_, i) => ({ ...days[i % days.length], date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10) }))
  calendarFixture = (vacations, selectedDate, fontSize, extended = false) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    @font-face{font-family:'Geist Variable';src:url(data:font/woff2;base64,${cyrillicFont}) format('woff2');font-weight:100 900;unicode-range:U+0400-052F,U+2DE0-2DFF,U+A640-A69F}
    @font-face{font-family:'Geist Variable';src:url(data:font/woff2;base64,${latinFont}) format('woff2');font-weight:100 900;unicode-range:U+0000-00FF}
    ${tokens}${css}\nhtml{font-size:${fontSize}px}body{margin:0;padding:8px;font-family:'Geist Variable',sans-serif}button{font:inherit}
    </style><div class="day-dashboard">${renderToStaticMarkup(createElement(Calendar, { days: extended ? extendedDays : days, schoolCalendar: vacations ? calendar : undefined,
      today: '2026-10-19', selectedDate, onSelect: () => {} }))}</div>`
} finally { await vite.close() }

const calendarMeasurement = `JSON.stringify((()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{top:r.top,height:r.height}},strip=document.querySelector('.day-dashboard-dates');return{
  card:box('.day-dashboard-calendar'),strip:box('.day-dashboard-dates'),pageWidth:document.documentElement.scrollWidth,
  buttons:[...document.querySelectorAll('[data-date]')].map((b,index,all)=>{const r=b.getBoundingClientRect();return{date:b.dataset.date,top:r.top,width:r.width,height:r.height,group:b.closest('.day-dashboard-vacation')?.getAttribute('aria-label')??null,gap:index?r.left-all[index-1].getBoundingClientRect().right:null}}),
  groups:[...document.querySelectorAll('.day-dashboard-vacation')].map(g=>{const r=g.getBoundingClientRect(),b=[...g.querySelectorAll('[data-date]')],f=b[0].getBoundingClientRect(),l=b.at(-1).getBoundingClientRect(),s=strip.getBoundingClientRect();return{top:f.top-r.top,bottom:r.bottom-f.bottom,left:f.left-r.left,right:r.right-l.right,unclipped:r.top>=s.top&&r.bottom<=s.bottom}}),
  scroll:strip.scrollLeft,canScroll:strip.scrollWidth>strip.clientWidth}})())`
function assertCalendarGeometry(layout, baseline, width, phase) {
  const near = (a, b) => Math.abs(a - b) <= 0.5
  const changed = layout.buttons.find((button, index) => {
    const saved = baseline.buttons[index]
    const previousGroup = layout.buttons[index - 1]?.group
    const extraGap = index && button.group !== previousGroup ? 8 * (Number(Boolean(button.group)) + Number(Boolean(previousGroup))) : 0
    return !saved || button.date !== saved.date || !near(button.top, saved.top) || !near(button.width, saved.width) || !near(button.height, saved.height)
      || button.gap !== null && !near(button.gap, saved.gap + extraGap)
  })
  if (!near(layout.card.height, baseline.card.height) || !near(layout.strip.height, baseline.strip.height)
    || layout.pageWidth > width || changed) throw Error(`Каникулы изменили геометрию: ${JSON.stringify({ width, phase, card: layout.card, baselineCard: baseline.card, changed })}`)
  if (layout.groups.some(group => !group.unclipped || ['top', 'bottom', 'left', 'right'].some(side => !near(group[side], 8)))) {
    throw Error(`Каникульная рамка требует видимый отступ8px с каждой стороны: ${JSON.stringify({ width, phase, groups: layout.groups })}`)
  }
}

const stickyMeasurement = `JSON.stringify((()=>{const s=document.querySelector('.day-dashboard-dates'),g=s.querySelector('.day-dashboard-vacation'),l=g?.querySelector('.day-dashboard-vacation-legend');if(!l)return null;
const rect=n=>{const r=n.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width}},sr=rect(s),gr=rect(g),lr=rect(l);return{strip:sr,group:gr,label:lr,scroll:s.scrollLeft,heading:rect(document.querySelector('.day-dashboard-heading')),
visible:lr.right>sr.left&&lr.left<sr.right&&lr.bottom>sr.top&&lr.top<sr.bottom}})())`
// @see ../docs/shared/design/statuses.md#matrix — fixture mirrors the icon/count/chevron columns.
const statusIcon = (status) => {
  const path = status === 'complete' ? '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>'
    : status === 'partial' ? '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>'
      : status === 'unknown' ? '<circle cx="12" cy="12" r="10"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01"/>'
        : '<circle cx="12" cy="12" r="10"/>'
  return `<svg class="edu-status-icon edu-status-icon-${status}" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
}
const chevron = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>'
const newIcon = '<svg class="edu-status-icon edu-status-icon-new" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><circle cx="19" cy="5" r="2"/></svg>'
const lessonTimeIcon = (phase) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${phase === 'current' ? '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' : '<path d="M5 3h14M5 21h14M7 3c0 5 5 6 5 9s-5 4-5 9m10-18c0 5-5 6-5 9s5 4 5 9"/>'}</svg>`
function renderRow([name, badge, tone, phase], open) {
  return `<li><details class="day-dashboard-lesson day-dashboard-lesson-${tone}" ${open ? 'open' : ''}>
    <summary><time>08:30</time><span class="day-dashboard-lesson-name">${name}${phase ? `<span class="day-dashboard-lesson-phase ${phase}" aria-label="${phase === 'current' ? 'До конца урока 35 мин' : 'Начнётся через 50 мин'}">${lessonTimeIcon(phase)}${phase === 'current' ? '35' : '50'} мин</span>` : ''}${name === 'История' ? `<span class="day-dashboard-lesson-new">${newIcon}Новое ДЗ</span>` : ''}</span>
    <span class="day-dashboard-lesson-badge" ${tone === 'none' ? 'aria-label="ДЗ не задано на последней сверке МЭШ"' : ''}>${badge.startsWith('ДЗ') || tone === 'none' ? '' : statusIcon(tone.includes('complete') ? 'complete' : tone === 'partial' ? 'partial' : tone === 'unknown' ? 'unknown' : 'ready')}${badge}${chevron}</span></summary>
    <div class="day-dashboard-lesson-body">Подробности задания и проверки.</div></details></li>`
}
function fixture(open, pastExpanded) {
  const pastNames = rows.slice(0, 2).map(([name]) => name).join(', ')
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  @font-face{font-family:'Geist Variable';src:url(data:font/woff2;base64,${cyrillicFont}) format('woff2');font-weight:100 900;unicode-range:U+0400-052F,U+2DE0-2DFF,U+A640-A69F}
  @font-face{font-family:'Geist Variable';src:url(data:font/woff2;base64,${latinFont}) format('woff2');font-weight:100 900;unicode-range:U+0000-00FF}
  ${tokens}${iconCss}${css}\nbody{margin:0;padding:8px;font-family:'Geist Variable',sans-serif}</style>
  <div class="day-dashboard"><section class="day-dashboard-card"><div class="day-dashboard-lesson-groups">
    <div class="day-dashboard-past-group"><button class="day-dashboard-past-toggle" aria-expanded="${pastExpanded}" type="button"><strong>Прошли · 2</strong><span>${pastNames}</span>${chevron}</button>
      ${pastExpanded ? `<ul class="day-dashboard-lessons day-dashboard-past-lessons">${rows.slice(0, 2).map((row) => renderRow(row, open)).join('')}</ul>` : ''}</div>
    <ul class="day-dashboard-lessons day-dashboard-current-lessons">${rows.slice(2).map((row) => renderRow(row, open)).join('')}</ul>
  </div></section></div>`
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
    for (const width of [320, 390, 540, 1024, 1600]) for (const fontSize of [16, 20]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 })
      let baseline
      for (const vacations of [false, true]) for (const selectedDate of ['2026-10-18', '2026-10-25']) {
        await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(calendarFixture(vacations, selectedDate, fontSize)).toString('base64')}` })
        await delay(80)
        await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })
        const measured = await send('Runtime.evaluate', { expression: calendarMeasurement, returnByValue: true })
        if (measured.exceptionDetails || !measured.result?.value) throw Error('Calendar geometry measurement failed')
        const layout = JSON.parse(measured.result.value)
        baseline ??= layout
        assertCalendarGeometry(layout, baseline, width, { vacations, selectedDate, fontSize })
        await send('Runtime.evaluate', { expression: "document.querySelector('.day-dashboard-dates').scrollLeft=100000" })
        const scrolled = JSON.parse((await send('Runtime.evaluate', { expression: calendarMeasurement, returnByValue: true })).result.value)
        assertCalendarGeometry(scrolled, baseline, width, 'horizontal-scroll')
        if (scrolled.canScroll && scrolled.scroll <= 0) throw Error('Calendar stopped scrolling horizontally')
        if (screenshotDir && vacations && selectedDate === '2026-10-18' && fontSize === 16) {
          const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
          mkdirSync(screenshotDir, { recursive: true })
          writeFileSync(join(screenshotDir, `calendar-${width}.png`), Buffer.from(shot.data, 'base64'))
        }
      }
      console.log(`Календарь ${width}px / шрифт ${fontSize}px: высота, размеры и линия дней сохраняются; отступ каникул 8px виден`)
      await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(calendarFixture(true, '2026-10-18', fontSize, true)).toString('base64')}` })
      await delay(80)
      await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })
      const snapshot = async () => JSON.parse((await send('Runtime.evaluate', { expression: stickyMeasurement, returnByValue: true })).result.value)
      const start = await snapshot()
      if (!start) throw Error('Подпись каникул должна находиться внутри своей группы, а не в общем заголовке')
      const groupStart = start.group.left - start.strip.left + start.scroll, groupEnd = groupStart + start.group.width
      for (const [phase, position] of [
        ['before', groupStart - start.strip.width - 30], ['enter', groupStart - start.strip.width + 60],
        ['start', groupStart - 30], ['middle', groupStart + start.group.width * .4],
        ['end', groupEnd - 8 - start.label.width / 2], ['after', groupEnd + 30],
      ]) {
        await send('Runtime.evaluate', { expression: `document.querySelector('.day-dashboard-dates').scrollLeft=${Math.max(0, position)}` })
        await delay(35)
        const live = await snapshot()
        const expectedLeft = Math.min(Math.max(live.group.left + 8, live.strip.left + 3), live.group.right - 8 - live.label.width)
        if (Math.abs(live.label.left - expectedLeft) > 1 || live.label.top < live.strip.top || live.label.bottom > live.group.top
          || live.label.top < live.heading.bottom || phase === 'before' && live.visible || phase === 'after' && live.visible
          || ['start', 'middle', 'end'].includes(phase) && !live.visible) {
          throw Error(`Sticky-подпись нарушила границы: ${JSON.stringify({ width, fontSize, phase, expectedLeft, live })}`)
        }
        if (screenshotDir && [320, 1024].includes(width) && fontSize === 16 && phase !== 'enter') {
          const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
          writeFileSync(join(screenshotDir, `calendar-sticky-${width}-${phase}.png`), Buffer.from(shot.data, 'base64'))
        }
      }
      console.log(`Sticky ${width}px / шрифт ${fontSize}px: до группы скрыта, слева следует, правым краем ограничена, после группы скрыта`)
    }
    for (const width of [320, 390, 540]) for (const pastExpanded of [false, true]) for (const open of [false, true]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true })
      await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(fixture(open, pastExpanded)).toString('base64')}` })
      await delay(160)
      const result = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify((()=>({
        width:innerWidth,scroll:document.documentElement.scrollWidth,
        past:(()=>{const p=document.querySelector('.day-dashboard-past-toggle'), n=p.querySelector('span');return{height:p.getBoundingClientRect().height, textFits:n.scrollWidth<=n.clientWidth, right:p.getBoundingClientRect().right}})(),
        rows:[...document.querySelectorAll('.day-dashboard-lesson summary')].map(s=>{const n=s.querySelector('.day-dashboard-lesson-name'),b=s.querySelector('.day-dashboard-lesson-badge'),nr=n.getBoundingClientRect(),br=b.getBoundingClientRect(),sr=s.getBoundingClientRect();return{name:n.textContent,badge:b.textContent,height:sr.height,nameLeft:nr.left,nameRight:nr.right,badgeLeft:br.left,badgeRight:br.right,centerGap:Math.abs((nr.top+nr.bottom-br.top-br.bottom)/2),nameFits:n.scrollWidth<=n.clientWidth,badgeFits:b.scrollWidth<=b.clientWidth}})
      }))())` })
      if (result.exceptionDetails || !result.result?.value) throw new Error('Chrome не смог измерить расписание.')
      const layout = JSON.parse(result.result.value)
      const bad = layout.rows.find((row) => row.badgeLeft < row.nameRight + 5 || row.centerGap > 7 || row.height > (row.name.startsWith('Практикум') ? 100 : 70) || !row.nameFits || !row.badgeFits || row.badgeRight > width - 18)
      if (layout.width !== width || layout.scroll > width || layout.past.height > 55 || layout.past.right > width - 18 || bad) throw new Error(`Сетка урока нарушена: ${JSON.stringify({ width, open, bad, scroll: layout.scroll })}`)
      if (screenshotDir) {
        mkdirSync(screenshotDir, { recursive: true })
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
        writeFileSync(join(screenshotDir, `schedule-${width}-${pastExpanded ? 'past-open' : 'past-closed'}-${open ? 'lesson-open' : 'lesson-closed'}.png`), Buffer.from(shot.data, 'base64'))
      }
      console.log(`${width}px, прошли ${pastExpanded ? 'раскрыты' : 'свёрнуты'}, уроки ${open ? 'раскрыты' : 'свёрнуты'}: ${layout.rows.length} строк`)
    }
  } finally { socket.close() }
} finally { proc.kill(); await delay(300); rmSync(profile, { recursive: true, force: true }) }
