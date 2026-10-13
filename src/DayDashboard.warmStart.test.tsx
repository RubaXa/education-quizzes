// @vitest-environment jsdom
// @see ../docs/product/dashboard.md#dashboard-warm-start
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

afterEach(() => { probe.selected = null; probe.next = null; probe.grade = null; probe.dashboardError = null; localStorage.clear(); sessionStorage.clear() })

describe('schedule warm start', () => {
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
