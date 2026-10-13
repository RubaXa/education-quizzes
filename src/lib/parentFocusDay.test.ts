// @see ../../docs/product/dashboard.md#parent-focus-day
import { describe, expect, it } from 'vitest'
import type { DayDashboardData } from './dayDashboardStore'
import { parentFocusDay } from './parentFocusDay'

const index: DayDashboardData = { schemaVersion: 1, kind: 'parent', today: '2026-10-13', timezone: 'Europe/Moscow', days: [
  { date: '2026-10-13', checkedAt: null, complete: true, schedule: [{ subject: 'История', start: '2026-10-13T05:30:00.000Z', end: '2026-10-13T06:15:00.000Z' }], homework: [], dayToken: null, homeworkDayToken: 'today' },
  { date: '2026-10-14', checkedAt: null, complete: true, schedule: [{ subject: 'Математика', start: '2026-10-14T05:30:00.000Z', end: '2026-10-14T06:15:00.000Z' }], homework: [], dayToken: null, homeworkDayToken: 'tomorrow' },
] }

describe('parent homework focus', () => {
  it('counts today before the first lesson starts', () => {
    expect(parentFocusDay(index, new Date('2026-10-13T05:29:00.000Z'))?.date).toBe('2026-10-13')
  })
  it('counts tomorrow from the first lesson start, leaving calendar navigation separate', () => {
    expect(parentFocusDay(index, new Date('2026-10-13T05:30:00.000Z'))?.date).toBe('2026-10-14')
  })
})
