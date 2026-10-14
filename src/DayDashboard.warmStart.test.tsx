// @vitest-environment jsdom
// @see ../docs/product/dashboard.md#dashboard-warm-start
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

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T05:00:00.000Z')) })
afterEach(() => { probe.selected = null; probe.next = null; probe.grade = null; probe.dashboardError = null; delete (allDays[0] as typeof allDays[0] & { homeworkUpdate?: unknown }).homeworkUpdate; allDays[0].schedule.splice(1); index.days = allDays; localStorage.clear(); sessionStorage.clear(); Element.prototype.scrollIntoView = originalScrollIntoView; vi.useRealTimers(); vi.restoreAllMocks() })

describe('schedule warm start', () => {
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
  it('keeps the selected day distinct from the next homework day', async () => {
    probe.selected = base(); probe.next = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('[aria-label="Расписание выбранного дня"]')?.textContent).toContain('Биология')
    expect(host.querySelector('[aria-label="Домашнее задание следующего учебного дня"]')?.textContent).toContain('История')
    await act(async () => { root.unmount() }); host.remove()
  })
  it('shows today without claiming yesterday or tomorrow is today when the index lacks a current-day row', async () => {
    index.days = [allDays[1]]
    probe.selected = base(); probe.next = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-selected-heading h1')?.textContent).toContain('13 октября')
    expect(host.querySelector('[aria-label="Домашнее задание следующего учебного дня"]')?.textContent).toContain('История')
    await act(async () => { root.unmount() }); host.remove()
  })
  it('opens upcoming lessons before class and folds the schedule after the last lesson', async () => {
    probe.selected = base(); probe.next = base()
    const host = document.createElement('div'); document.body.append(host)
    const first = createRoot(host)
    await act(async () => { first.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector<HTMLDetailsElement>('.day-dashboard-lesson')?.open).toBe(true)
    await act(async () => { first.unmount() })
    vi.setSystemTime(new Date('2026-10-13T06:20:00.000Z'))
    const second = createRoot(host)
    await act(async () => { second.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('[aria-label="Расписание выбранного дня"]')?.getAttribute('data-collapsed')).toBe('true')
    expect(host.querySelector('[aria-label="Домашнее задание следующего учебного дня"]')).not.toBeNull()
    await act(async () => { host.querySelector<HTMLButtonElement>('.day-dashboard-schedule-toggle')?.click() })
    expect(host.querySelector<HTMLDetailsElement>('.day-dashboard-lesson')?.open).toBe(false)
    await act(async () => { host.querySelector<HTMLElement>('.day-dashboard-lesson summary')?.click() })
    expect(host.querySelector<HTMLDetailsElement>('.day-dashboard-lesson')?.open).toBe(true)
    await act(async () => { second.unmount() }); host.remove()
  })
  it('does not mark new homework read when an upcoming lesson opens automatically', async () => {
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
  it('folds only the finished lesson while a later lesson is still ahead', async () => {
    index.days[0].schedule.push({ subject: 'Математика', start: '2026-10-13T07:30:00.000Z', end: '2026-10-13T08:15:00.000Z' })
    vi.setSystemTime(new Date('2026-10-13T06:20:00.000Z'))
    probe.selected = base(); probe.next = base()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('[aria-label="Расписание выбранного дня"]')?.getAttribute('data-collapsed')).toBe('false')
    const lessons = host.querySelectorAll<HTMLDetailsElement>('.day-dashboard-lesson')
    expect([...lessons].map((lesson) => lesson.open)).toEqual([false, true])
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

  it('opens with the last complete next-day homework and grades before live streams answer', async () => {
    probe.selected = { ...base(), ready: true, page: { targetDate: '2026-10-13' }, subjects: [] }
    probe.next = { ...base(), ready: true, page: { targetDate: '2026-10-14' },
      subjects: [{ id: 'history', name: 'История', icon: '📜', tasks: [{ id: 'history', title: 'Параграф 7', kind: 'written', status: 'verified' }] }] }
    probe.grade = { gradeSummary: [{ id: 'russian', name: 'Русский язык', average: 4.75 }],
      grades: [{ id: 'russian', grades: [{ mark: 5, weight: 1 }] }], gradeAsOf: '2026-10-13T12:00:00.000Z' }
    const host = document.createElement('div'); document.body.append(host)
    const first = createRoot(host)
    await act(async () => { first.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-homework-summary')?.textContent).toContain('Всё заданное сделано')
    expect(host.querySelector('.day-dashboard-grades')?.textContent).toContain('4,75')
    await act(async () => { first.unmount() })

    probe.selected = base(); probe.next = base(); probe.grade = null
    const reopened = createRoot(host)
    await act(async () => { reopened.render(<DayDashboard token="calendar" parent />) })
    expect(host.querySelector('.day-dashboard-homework-summary')?.textContent).toContain('Всё заданное сделано')
    expect(host.querySelector('.day-dashboard-homework-complete')?.textContent).toContain('История')
    expect(host.querySelector('.day-dashboard-grades')?.textContent).toContain('4,75')
    expect(host.textContent).not.toContain('Срез оценок ещё не опубликован')
    await act(async () => { reopened.unmount() }); host.remove()
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
    const homework = host.querySelector('[aria-label="Домашнее задание следующего учебного дня"]')
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
