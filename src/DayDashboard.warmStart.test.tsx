// @vitest-environment jsdom
// @see ../docs/modules/school-diary/dashboard.md#dashboard-warm-start
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({ selected: null as any, next: null as any, grade: null as any,
  dashboardError: null as null | ((error: Error) => void) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const lessonStart = '2026-10-13T05:30:00.000Z'
const index = { schemaVersion: 1, kind: 'parent', today: '2026-10-13', timezone: 'Europe/Moscow', days: [{
  date: '2026-10-13', checkedAt: '2026-10-12T13:32:00.000Z', complete: true,
  schedule: [{ subject: 'Биология', start: lessonStart, end: '2026-10-13T06:15:00.000Z' }],
  homework: [{ subject: 'Биология', text: 'Параграф 5' }], dayToken: 'grade-13', homeworkDayToken: 'work-13',
}, { date: '2026-10-14', checkedAt: '2026-10-13T13:32:00.000Z', complete: true,
  schedule: [{ subject: 'История', start: '2026-10-14T05:30:00.000Z', end: '2026-10-14T06:15:00.000Z' }],
  homework: [{ subject: 'История', text: 'Параграф 7' }], dayToken: null, homeworkDayToken: 'work-14' }] }
const allDays = index.days
const originalScrollIntoView = Element.prototype.scrollIntoView
const base = () => ({ page: undefined, linkedPage: undefined, subjects: [], uploads: [], reviews: [], tests: {}, scores: {},
  parentDecisions: { events: [], ready: false, error: '' }, ready: false })

vi.mock('firebase/auth', async (importOriginal) => ({ ...await importOriginal<typeof import('firebase/auth')>(),
  getAuth: () => ({ currentUser: { uid: 'device' }, authStateReady: async () => {} }) }))
vi.mock('@/lib/dayDashboardStore', () => ({ readCachedDayDashboard: () => index,
  clearCachedDayDashboard: (token: string) => localStorage.removeItem(`education-day-dashboard-v1:${token}`),
  watchDayDashboard: (_token: string, _onChange: unknown, onError: (error: Error) => void) => { probe.dashboardError = onError; return () => {} } }))
vi.mock('@/lib/dayStore', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/dayStore')>(),
  watchDayPage: (_token: string, onChange: (value: unknown) => void) => { if (probe.grade) onChange(probe.grade); return () => {} } }))
vi.mock('@/lib/useDashboardDayWork', () => ({ useDashboardDayWork: (_token: string, date: string) => date === '2026-10-13' ? probe.selected : probe.next ?? base() }))
vi.mock('@/lib/personalAccess', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/personalAccess')>(),
  currentEducationPersonId: () => '' }))

import DayDashboard from './DayDashboard'
import { homeworkUpdateKey, wasHomeworkUpdateSeen } from './lib/homeworkUpdateReceipt'

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T05:00:00.000Z')) })
afterEach(() => { probe.selected = null; probe.next = null; probe.grade = null; probe.dashboardError = null; for (const day of allDays) delete (day as typeof day & { homeworkUpdate?: unknown }).homeworkUpdate; allDays[0].schedule.splice(1); index.days = allDays; localStorage.clear(); sessionStorage.clear(); window.location.hash = ''; Element.prototype.scrollIntoView = originalScrollIntoView; vi.useRealTimers(); vi.restoreAllMocks() })

describe('schedule warm start', () => {
  /** @see ../docs/modules/school-diary/school-calendar.md#представление */
  it('shows MESH vacations in both roles without losing the next real homework date', async () => {
    vi.setSystemTime(new Date('2026-10-24T09:00:00Z'))
    const calendar = { schemaVersion: 1, source: 'mesh', from: '2026-09-01', to: '2027-08-31', revision: 'a'.repeat(64),
      checkedAt: '2026-10-19T10:00:00Z', vacations: [{ from: '2026-10-24', to: '2026-11-01', title: 'Первые каникулы' }] }
    Object.assign(index, { schoolCalendar: calendar })
    index.days = [{ ...allDays[0], date: '2026-10-24', schedule: [], homework: [], dayToken: null, homeworkDayToken: null } as any,
      { ...allDays[0], date: '2026-10-25', schedule: [], homework: [], dayToken: null, homeworkDayToken: null } as any,
      { ...allDays[1], date: '2026-11-02' }]
    probe.selected = base(); probe.next = base()
    try {
      for (const parent of [true, false]) {
        const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
        try {
          await act(async () => root.render(<DayDashboard token="calendar" parent={parent} />))
          expect(host.querySelector('.day-dashboard-vacation')?.getAttribute('aria-label')).toContain('Первые каникулы')
          expect(host.querySelector('.day-dashboard-heading .day-dashboard-vacation-legend')).toBeNull()
          expect(host.querySelector('.day-dashboard-vacation .day-dashboard-vacation-legend')?.textContent).toContain('Каникулы')
          expect(host.textContent).toContain('По календарю МЭШ')
          expect(host.querySelector('[aria-label="Домашнее задание"] time')?.getAttribute('datetime')).toBe('2026-11-02')
          await act(async () => host.querySelector<HTMLButtonElement>('[data-date="2026-10-25"]')!.click())
          expect(host.querySelector('[aria-pressed="true"]')?.getAttribute('data-date')).toBe('2026-10-25')
          expect(host.querySelector('[aria-current="date"]')?.getAttribute('data-date')).toBe('2026-10-24')
        } finally { await act(async () => root.unmount()); host.remove(); sessionStorage.clear() }
      }
    } finally { delete (index as typeof index & { schoolCalendar?: unknown }).schoolCalendar }
  })
  /** @see ../docs/modules/school-diary/dashboard.md#compact-homework */
  it('uses the same compact card in both roles and keeps Monday after Friday', async () => {
    vi.setSystemTime(new Date('2026-10-16T12:00:00.000Z'))
    index.days = [{...allDays[0],date:'2026-10-16'},{...allDays[1],date:'2026-10-19'}]
    probe.selected = base()
    probe.next = {...base(),ready:true,subjects:[{id:'history',name:'История',icon:'📚',tasks:[{id:'repeat',title:'Повторить параграф 7',kind:'written',status:'unknown'}]}]}
    for (const parent of [true,false]) {
      const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
      await act(async()=>root.render(<DayDashboard token="calendar" parent={parent}/>))
      const card=host.querySelector('[aria-label="Домашнее задание"]')!
      expect(card.querySelector('h2')?.textContent).toBe('Домашнее задание')
      expect(card.querySelector('time')?.dateTime).toBe('2026-10-19')
      expect(card.querySelector('time')?.textContent).toBe('Понедельник, 19 октября')
      expect(card.textContent).not.toContain('на завтра')
      expect(card.querySelector('.day-dashboard-homework-summary')).toBeNull()
      expect(host.textContent).not.toContain('следующий учебный день')
      expect(host.querySelector('.day-dashboard-source')).toBeNull()
      await act(async()=>card.querySelector<HTMLButtonElement>('.day-dashboard-homework-row')!.click())
      expect(window.location.hash).toBe('#/day/work-14')
      await act(async()=>root.unmount());host.remove()
    }
  })
  it('keeps a clear MESH assignment separate from missing photographic evidence in the parent overview', async () => {
    const homework = allDays[1].homework
    allDays[1].homework = [{ subject: 'Русский язык', text: 'Упр. 218, 223 (выписать только средства выразительности)' }]
    probe.selected = base()
    probe.next = { ...base(), ready: true, subjects: [{ id: 'russian', name: 'Русский язык', icon: '✍️', tasks: [
      { id: 'mesh-russian', title: 'Упр. 218 и 223: выписать средства выразительности', kind: 'written' },
    ] }], reviews: [{ id: 'review-russian', taskId: 'mesh-russian', status: 'cannot-assess',
      summary: 'Большой экспертный разбор не должен занимать весь обзор',
      studentFeedback: { title: '№ 218 проверен; № 223 не виден целиком' },
      assessmentBasis: { outcome: 'unresolved', unresolvedReason: 'missing-evidence' } }] }
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
      const row = host.querySelector('.day-dashboard-homework-row')
      expect(row?.textContent).toContain('Не вся работа видна')
      expect(row?.textContent).toContain('№ 218 проверен; № 223 не виден целиком')
      expect(row?.textContent).not.toContain('Критерий неясен')
      expect(row?.textContent).not.toContain('Большой экспертный разбор')
    } finally {
      await act(async () => root.unmount()); host.remove()
      allDays[1].homework = homework
    }
  })
  it('shows an optional-only test in the lesson without counting it as homework', async () => {
    const page = { targetDate: '2026-10-13', subjects: [{ id: 'biology', tasks: [] }],
      testPlacements: [{ subjectId: 'biology', token: 'quiz-root' }] }
    probe.selected = { ...base(), ready: true, page, subjects: [{ id: 'biology', name: 'Биология', icon: '🧬', tasks: [] }],
      tests: { 'quiz-root': { status: 'open', testId: 'quiz-1', title: 'Самопроверка', familyOptional: true } } }
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
      const lesson = host.querySelector<HTMLDetailsElement>('.day-dashboard-lesson')!
      expect(lesson.querySelector('.day-dashboard-lesson-badge')?.textContent).toBe('По желанию')
      expect(lesson.querySelector('.day-dashboard-lesson-badge')?.textContent).not.toContain('0 из 1')
      await act(async () => { lesson.open = true })
      expect(lesson.querySelector('.day-dashboard-lesson-body')?.textContent).toContain('не входит в счётчик заданий')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
  it('shows only a two-em dash for confirmed empty homework with an accessible explanation', async () => {
    index.days = [{ ...allDays[0], homework: [] }, allDays[1]]
    probe.selected = { ...base(), ready: true }
    probe.next = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    const lesson = host.querySelector<HTMLDetailsElement>('.day-dashboard-lesson')!
    expect(lesson.querySelector('.day-dashboard-lesson-badge')?.textContent).toBe('⸻')
    expect(lesson.querySelector('[data-status="not-assigned"]')).toBeNull()
    expect(lesson.querySelector('.day-dashboard-lesson-badge')?.getAttribute('aria-label')).toContain('на последней сверке МЭШ')
    await act(async () => { lesson.open = true })
    expect(lesson.querySelector('.day-dashboard-lesson-body')?.textContent).toContain('На последней сверке МЭШ')
    expect(lesson.textContent).not.toContain('может появиться позже')
    await act(async () => { root.unmount() }); host.remove()
  })
  it('rewords a saved empty badge immediately on a warm start', async () => {
    localStorage.setItem('education-day-dashboard-lesson-v1:parent:calendar:2026-10-13', JSON.stringify({ version: 1, lessons: [
      { key: `${lessonStart}|Биология`, tone: 'none', badge: 'Пока нет ДЗ', items: [] },
    ] }))
    probe.selected = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-lesson-badge')?.textContent).toBe('⸻')
    expect(host.textContent).not.toContain('Пока нет ДЗ')
    await act(async () => { root.unmount() }); host.remove()
  })
  it('acknowledges a new subject when its homework is opened from the next-day card', async () => {
    const at = '2026-10-13T04:00:00.000Z'
    Object.assign(allDays[1], { homeworkUpdate: { at, subjects: ['История'] } })
    probe.selected = base()
    probe.next = { ...base(), ready: true, subjects: [{ id: 'history', name: 'История', icon: '📚',
      tasks: [{ id: 'history-task', title: 'Параграф 7', kind: 'written', status: 'unknown' }] }] }
    const key = homeworkUpdateKey('calendar', '2026-10-14', 'История', at)
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(wasHomeworkUpdateSeen(key)).toBe(false)
    await act(async () => { host.querySelector<HTMLButtonElement>('.day-dashboard-homework-row')?.click() })
    expect(wasHomeworkUpdateSeen(key)).toBe(true)
    await act(async () => { root.unmount() }); host.remove()
  })
  it('acknowledges only the focused subject when opening it from a notification', async () => {
    const at = '2026-10-13T04:00:00.000Z'
    allDays[0].schedule.push({ subject: 'История', start: '2026-10-13T06:30:00.000Z', end: '2026-10-13T07:15:00.000Z' })
    Object.assign(allDays[0], { homeworkUpdate: { at, subjects: ['Биология', 'История'] } })
    sessionStorage.setItem('education-dashboard-focus-subject', 'Биология')
    Element.prototype.scrollIntoView = vi.fn()
    probe.selected = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(wasHomeworkUpdateSeen(homeworkUpdateKey('calendar', '2026-10-13', 'Биология', at))).toBe(true)
    expect(wasHomeworkUpdateSeen(homeworkUpdateKey('calendar', '2026-10-13', 'История', at))).toBe(false)
    await act(async () => { root.unmount() }); host.remove()
  })
  it('reveals a focused lesson after classes and aligns its start', async () => {
    vi.setSystemTime(new Date('2026-10-13T06:20:00.000Z'))
    sessionStorage.setItem('education-dashboard-focus-subject', 'Биология')
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    probe.selected = base(); probe.next = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('[aria-label="Расписание выбранного дня"]')?.getAttribute('data-collapsed')).toBe('false')
    expect(host.querySelector<HTMLDetailsElement>('.day-dashboard-lesson')?.open).toBe(true)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    await act(async () => { root.unmount() }); host.remove()
  })
  it('opens the finished group when navigation targets a completed lesson during the school day', async () => {
    allDays[0].schedule.push({ subject: 'История', start: '2026-10-13T06:30:00.000Z', end: '2026-10-13T07:15:00.000Z' })
    vi.setSystemTime(new Date('2026-10-13T06:40:00.000Z'))
    sessionStorage.setItem('education-dashboard-focus-subject', 'Биология')
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    probe.selected = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-past-toggle')?.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector<HTMLDetailsElement>('.day-dashboard-past-lessons .day-dashboard-lesson')?.open).toBe(true)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    await act(async () => { root.unmount() }); host.remove()
  })
  it('summarizes multiple completed lessons without hiding the lesson in progress', async () => {
    allDays[0].schedule.push(
      { subject: 'Математика', start: '2026-10-13T06:20:00.000Z', end: '2026-10-13T06:30:00.000Z' },
      { subject: 'История', start: '2026-10-13T06:30:00.000Z', end: '2026-10-13T07:15:00.000Z' },
    )
    vi.setSystemTime(new Date('2026-10-13T06:40:00.000Z'))
    probe.selected = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    const group = host.querySelector<HTMLButtonElement>('.day-dashboard-past-toggle')!
    expect(group.textContent).toContain('Прошли · 2')
    expect(group.textContent).toContain('Биология, Математика')
    expect(host.querySelectorAll('.day-dashboard-current-lessons .day-dashboard-lesson')).toHaveLength(1)
    expect(host.querySelector('.day-dashboard-current-lessons')?.textContent).toContain('История')
    expect(host.querySelector('.day-dashboard-current-lessons')?.textContent).not.toContain('Биология')
    await act(async () => { root.unmount() }); host.remove()
  })
  it('shows a countdown only for the nearest future lesson and a distinct countdown for the current lesson', async () => {
    allDays[0].schedule.push(
      { subject: 'Математика', start: '2026-10-13T06:30:00.000Z', end: '2026-10-13T07:15:00.000Z' },
      { subject: 'История', start: '2026-10-13T07:30:00.000Z', end: '2026-10-13T08:15:00.000Z' },
    )
    vi.setSystemTime(new Date('2026-10-13T06:20:00.000Z'))
    probe.selected = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
      const math = host.querySelector<HTMLDetailsElement>('.day-dashboard-lesson[data-subject="Математика"]')!
      const history = host.querySelector<HTMLDetailsElement>('.day-dashboard-lesson[data-subject="История"]')!
      expect(math.querySelector('.day-dashboard-lesson-phase.waiting')?.textContent).toContain('10 мин')
      expect(math.querySelector('.day-dashboard-lesson-phase.waiting')?.getAttribute('aria-label')).toContain('Начнётся через')
      expect(history.querySelector('.day-dashboard-lesson-phase')).toBeNull()
      vi.setSystemTime(new Date('2026-10-13T06:40:00.000Z'))
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(math.querySelector('.day-dashboard-lesson-phase.current')?.textContent).toContain('35 мин')
      expect(math.querySelector('.day-dashboard-lesson-phase.current')?.getAttribute('aria-label')).toContain('До конца урока')
      expect(math.querySelector('.day-dashboard-lesson-phase.current')?.textContent).not.toContain('Идёт')
      expect(history.querySelector('.day-dashboard-lesson-phase.waiting')?.textContent).toContain('50 мин')
      expect(host.querySelectorAll('.day-dashboard-lesson-phase.waiting')).toHaveLength(1)
      vi.setSystemTime(new Date('2026-10-13T06:41:00.000Z'))
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(math.querySelector('.day-dashboard-lesson-phase.current')?.textContent).toContain('34 мин')
      expect(history.querySelector('.day-dashboard-lesson-phase.waiting')?.textContent).toContain('49 мин')
      vi.setSystemTime(new Date('2026-10-13T07:15:00.000Z'))
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(host.querySelector('.day-dashboard-past-toggle')?.textContent).toContain('Прошли · 2')
      expect(host.querySelector('.day-dashboard-current-lessons .day-dashboard-lesson-phase.waiting')?.textContent).toContain('15 мин')
      await act(async () => { host.querySelectorAll<HTMLButtonElement>('.day-dashboard-date')[1]?.click() })
      expect(host.querySelectorAll('.day-dashboard-lesson-phase')).toHaveLength(0)
    } finally { await act(async () => root.unmount()); host.remove() }
  })
  it('keeps the selected day distinct from the next homework day', async () => {
    probe.selected = base(); probe.next = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('[aria-label="Расписание выбранного дня"]')?.textContent).toContain('Биология')
    expect(host.querySelector('[aria-label="Домашнее задание"]')?.textContent).toContain('История')
    await act(async () => { root.unmount() }); host.remove()
  })
  it('shows today without claiming yesterday or tomorrow is today when the index lacks a current-day row', async () => {
    index.days = [allDays[1]]
    probe.selected = base(); probe.next = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-selected-heading h1')?.textContent).toContain('13 октября')
    expect(host.querySelector('[aria-label="Домашнее задание"]')?.textContent).toContain('История')
    await act(async () => { root.unmount() }); host.remove()
  })
  it('keeps upcoming lesson details compact before class and folds the schedule after the last lesson', async () => {
    probe.selected = base(); probe.next = base()
    const host = document.createElement('div'); document.body.append(host)
    const first = createRoot(host)
    await act(async () => { first.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector<HTMLDetailsElement>('.day-dashboard-lesson')?.open).toBe(false)
    await act(async () => { first.unmount() })
    vi.setSystemTime(new Date('2026-10-13T06:20:00.000Z'))
    const second = createRoot(host)
    await act(async () => { second.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('[aria-label="Расписание выбранного дня"]')?.getAttribute('data-collapsed')).toBe('true')
    expect(host.querySelector('[aria-label="Домашнее задание"]')).not.toBeNull()
    await act(async () => { host.querySelector<HTMLButtonElement>('.day-dashboard-schedule-toggle')?.click() })
    expect(host.querySelector<HTMLDetailsElement>('.day-dashboard-lesson')?.open).toBe(false)
    await act(async () => { host.querySelector<HTMLElement>('.day-dashboard-lesson summary')?.click() })
    expect(host.querySelector<HTMLDetailsElement>('.day-dashboard-lesson')?.open).toBe(true)
    await act(async () => { second.unmount() }); host.remove()
  })
  it('does not mark new homework read when an upcoming lesson appears compactly', async () => {
    Object.assign(index.days[0], { homeworkUpdate: { at: '2026-10-13T04:00:00.000Z', subjects: ['Биология'] } })
    probe.selected = base(); probe.next = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-lesson-new')?.textContent).toBe('Новое ДЗ')
    await act(async () => { host.querySelector<HTMLElement>('.day-dashboard-lesson summary')?.click() })
    expect(host.querySelector('.day-dashboard-lesson-new')).toBeNull()
    await act(async () => { root.unmount() }); host.remove()
  })
  it('groups finished lessons while the current and future lessons stay visible', async () => {
    index.days[0].schedule.push(
      { subject: 'Математика', start: '2026-10-13T06:30:00.000Z', end: '2026-10-13T07:15:00.000Z' },
      { subject: 'История', start: '2026-10-13T07:30:00.000Z', end: '2026-10-13T08:15:00.000Z' },
    )
    vi.setSystemTime(new Date('2026-10-13T06:40:00.000Z'))
    probe.selected = base(); probe.next = base()
    probe.selected = { ...base(), ready: true, page: { targetDate: '2026-10-13' },
      subjects: [{ id: 'biology', name: 'Биология', tasks: [{ id: 'biology', title: 'Ткани', kind: 'written', status: 'verified' }] },
        { id: 'mathematics', name: 'Математика', tasks: [{ id: 'math', title: 'Пример', kind: 'written', status: 'unknown' }] }],
      uploads: [{ id: 'pending-math', taskId: 'math', status: 'pending' }] }
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('[aria-label="Расписание выбранного дня"]')?.getAttribute('data-collapsed')).toBe('false')
    const past = host.querySelector<HTMLButtonElement>('.day-dashboard-past-toggle')!
    expect(past.getAttribute('aria-expanded')).toBe('false')
    expect(past.textContent).toContain('Биология')
    expect(host.querySelector('.day-dashboard-past-lessons')).toBeNull()
    const visible = host.querySelectorAll<HTMLDetailsElement>('.day-dashboard-current-lessons .day-dashboard-lesson')
    expect([...visible].map((lesson) => lesson.open)).toEqual([false, false])
    expect(visible[0].querySelector('.day-dashboard-lesson-phase.current')?.getAttribute('aria-label')).toContain('До конца урока')
    expect(visible[0].textContent).not.toContain('Идёт')
    expect(visible[1].querySelector('.day-dashboard-lesson-phase.waiting')?.getAttribute('aria-label')).toContain('Начнётся через')
    expect(visible[0].querySelector('.day-dashboard-lesson-badge')?.textContent).toContain('0 из 1')
    await act(async () => { past.click() })
    expect(past.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelectorAll('.day-dashboard-past-lessons .day-dashboard-lesson')).toHaveLength(1)
    expect(host.querySelector('.day-dashboard-past-lessons .day-dashboard-lesson-badge')?.textContent).toContain('1 из 1')
    await act(async () => { visible[0].querySelector<HTMLElement>('summary')?.click() })
    expect(visible[0].open).toBe(true)
    expect(host.querySelector<HTMLDetailsElement>('.day-dashboard-past-lessons .day-dashboard-lesson')?.open).toBe(false)
    await act(async () => { root.unmount() }); host.remove()
  })
  it('keeps a confirmed live completion and reuses it on the next opening', async () => {
    probe.selected = { ...base(), ready: true, page: { targetDate: '2026-10-13' },
      subjects: [{ id: 'biology', name: 'Биология', tasks: [{ id: 'biology', title: 'Ткани', kind: 'written', status: 'verified' }] }] }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-lesson-badge')?.textContent).toContain('1 из 1')
    expect(localStorage.getItem('education-day-dashboard-lesson-v1:parent:calendar:2026-10-13')).toContain('1 из 1')
    await act(async () => { root.unmount() })
    const second = createRoot(host)
    probe.selected = base()
    await act(async () => { second.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-lesson-badge')?.textContent).toContain('1 из 1')
    await act(async () => { second.unmount() })
    host.remove()
  })

  it('uses a compact badge for a previous-day homework reference, including a saved lesson', async () => {
    const mathStart = '2026-10-13T07:30:00.000Z'
    index.days[0].schedule.push({ subject: 'Математика', start: mathStart, end: '2026-10-13T08:15:00.000Z' })
    localStorage.setItem('education-day-dashboard-lesson-v1:parent:calendar:2026-10-13', JSON.stringify({ version: 1, lessons: [
      { key: `${mathStart}|Математика`, tone: 'unknown', badge: 'См. 12 октября', items: [], referenceDate: '2026-10-12', referenceText: 'Смотрите ДЗ на понедельник 12.10' },
    ] }))
    probe.selected = base(); probe.next = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    const badge = host.querySelector('.day-dashboard-lesson[data-subject="Математика"] .day-dashboard-lesson-badge')
    expect(badge?.textContent).toContain('ДЗ 12.10')
    expect(badge?.getAttribute('aria-label')).toBe('См. ДЗ за 12 октября')
    await act(async () => { root.unmount() }); host.remove()
  })

  it('keeps a complete saved badge through incomplete live streams', async () => {
    localStorage.setItem('education-day-dashboard-lesson-v1:parent:calendar:2026-10-13', JSON.stringify({ version: 1, lessons: [
      { key: `${lessonStart}|Биология`, tone: 'complete', badge: '1 из 1', items: [{ id: 'biology', title: 'Ткани', state: 'done', detail: 'Работа проверена' }] },
    ] }))
    probe.selected = base()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-lesson-badge')?.textContent).toContain('1 из 1')
    expect(host.querySelector('.day-dashboard-lesson')?.className).toContain('complete')
    probe.selected = { ...base(), subjects: [{ id: 'biology', name: 'Биология', tasks: [{ id: 'biology', title: 'Ткани', kind: 'written', status: 'unknown' }] }] }
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-lesson-badge')?.textContent).toContain('1 из 1')
    expect(host.querySelector('.day-dashboard-lesson-badge')?.textContent).not.toContain('0 из 1')
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('turns a saved checking label into a count on a warm start', async () => {
    localStorage.setItem('education-day-dashboard-lesson-v1:parent:calendar:2026-10-13', JSON.stringify({ version: 1, lessons: [
      { key: `${lessonStart}|Биология`, tone: 'checking', badge: 'Проверяем', items: [{ id: 'biology', title: 'Ткани', state: 'checking', detail: 'Ждём проверки' }] },
    ] }))
    probe.selected = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-lesson-badge')?.textContent).toContain('0 из 1')
    expect(host.querySelector<HTMLDetailsElement>('.day-dashboard-lesson')?.open).toBe(false)
    await act(async () => { root.unmount() }); host.remove()
  })

  it('opens with the last complete next-day homework and grades before live streams answer', async () => {
    probe.selected = { ...base(), ready: true, page: { targetDate: '2026-10-13' }, subjects: [] }
    probe.next = { ...base(), ready: true, page: { targetDate: '2026-10-14' },
      subjects: [{ id: 'history', name: 'История', icon: '📜', tasks: [{ id: 'history', title: 'Параграф 7', kind: 'written', status: 'verified' }] }] }
    probe.grade = { gradeSummary: [{ id: 'russian', name: 'Русский язык', average: 4.75 }],
      grades: [{ id: 'russian', grades: [{ mark: 5, weight: 1 }] }], gradeAsOf: '2026-10-13T12:00:00.000Z' }
    const host = document.createElement('div'); document.body.append(host)
    const first = createRoot(host)
    await act(async () => { first.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-homework-complete summary')?.textContent).toContain('Сделано · 1')
    expect(host.querySelector('.day-dashboard-grades')?.textContent).toContain('4,75')
    await act(async () => { first.unmount() })

    probe.selected = base(); probe.next = base(); probe.grade = null
    const reopened = createRoot(host)
    await act(async () => { reopened.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-homework-complete summary')?.textContent).toContain('Сделано · 1')
    expect(host.querySelector('.day-dashboard-homework-complete')?.textContent).toContain('История')
    expect(host.querySelector('.day-dashboard-grades')?.textContent).toContain('4,75')
    expect(host.textContent).not.toContain('Срез оценок ещё не опубликован')
    await act(async () => { reopened.unmount() }); host.remove()
  })

  it('shows the work and teacher comment for the tapped mark, including two equal marks', async () => {
    probe.selected = base(); probe.next = base()
    probe.grade = { gradeSummary: [{ id: 'math', name: 'Математика', average: 5 }], grades: [{ id: 'math', grades: [
      { mark: 5, weight: 1, sourceId: '11', date: '2026-10-12', workType: 'Домашнее задание', comment: 'Проверь оформление' },
      { mark: 5, weight: 1, sourceId: '12', date: '2026-10-13', workType: 'Практическая работа' },
    ] }] }
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    const subject = host.querySelector<HTMLDetailsElement>('.day-dashboard-grade')!
    await act(async () => { subject.open = true })
    const buttons = subject.querySelectorAll<HTMLButtonElement>('.day-dashboard-grade-detail li button')
    expect(buttons).toHaveLength(2)
    await act(async () => { buttons[0].click() })
    expect(subject.querySelector('.day-dashboard-mark-detail')?.textContent).toContain('Домашнее задание')
    expect(subject.querySelector('.day-dashboard-mark-detail')?.textContent).toContain('Проверь оформление')
    await act(async () => { buttons[1].click() })
    expect(subject.querySelector('.day-dashboard-mark-detail')?.textContent).toContain('Практическая работа')
    expect(subject.querySelector('.day-dashboard-mark-detail')?.textContent).not.toContain('Проверь оформление')
    expect(buttons[1].getAttribute('aria-expanded')).toBe('true')
    await act(async () => { buttons[1].click() })
    expect(subject.querySelector('.day-dashboard-mark-detail')).toBeNull()
    await act(async () => { root.unmount() }); host.remove()
  })

  it('keeps newly published MESH subjects visible while saved work statuses are incomplete', async () => {
    index.days[1].homework.push({ subject: 'Литература', text: 'С. 91–92 (читать)' })
    localStorage.setItem('education-day-dashboard-view-v1:parent:calendar:work:work-14', JSON.stringify({ version: 1,
      data: [{ subject: { id: 'literature', name: 'Литература', icon: '📚', tasks: [{ title: 'Читать' }] },
        items: [{ id: 'lit', title: 'Читать', state: 'todo', detail: 'Осталось прочитать' }], done: 0, group: 'action' }] }))
    probe.selected = base(); probe.next = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    const homework = host.querySelector('[aria-label="Домашнее задание"]')
    expect(homework?.textContent).toContain('Литература')
    expect(homework?.textContent).toContain('История')
    expect(homework?.textContent).toContain('Параграф 7')
    await act(async () => { root.unmount() }); host.remove()
    index.days[1].homework.pop()
  })

  it('does not present assigned work as a completion status on a cold start', async () => {
    probe.selected = base()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-lesson-badge')?.textContent).not.toContain('Задано')
    expect(host.querySelector('.day-dashboard-lesson-badge')?.textContent).not.toContain('0 из 1')
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('removes the saved private status after confirmed access revocation', async () => {
    localStorage.setItem('education-day-dashboard-lesson-v1:parent:calendar:2026-10-13', JSON.stringify({ version: 1, lessons: [
      { key: `${lessonStart}|Биология`, tone: 'complete', badge: '1 из 1', items: [] },
    ] }))
    localStorage.setItem('education-day-dashboard-view-v1:parent:calendar:grades:grade-13', JSON.stringify({ version: 1,
      data: { gradeSummary: [{ id: 'russian', name: 'Русский язык', average: 4.75 }] } }))
    probe.selected = base()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-lesson-badge')?.textContent).toContain('1 из 1')
    await act(async () => { probe.dashboardError?.(Object.assign(new Error('Access revoked'), { code: 'permission-denied' })) })
    expect(host.querySelector('.day-dashboard-lesson')).toBeNull()
    expect(localStorage.getItem('education-day-dashboard-lesson-v1:parent:calendar:2026-10-13')).toBeNull()
    expect(localStorage.getItem('education-day-dashboard-view-v1:parent:calendar:grades:grade-13')).toBeNull()
    await act(async () => { root.unmount() })
    host.remove()
  })
})
