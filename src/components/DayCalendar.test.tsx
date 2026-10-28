// @vitest-environment jsdom
/** @see ../../docs/modules/school-diary/school-calendar.md#представление */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import DayCalendar from './DayCalendar'
import type { IndexedDay } from '@/lib/dayDashboardStore'
import type { SchoolCalendar } from '../../day/school-calendar.mjs'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const calendar: SchoolCalendar = { schemaVersion: 1, source: 'mesh', from: '2026-09-01', to: '2027-08-31',
  checkedAt: '2026-10-19T10:00:00Z', revision: 'a'.repeat(64), vacations: [{ from: '2026-10-24', to: '2026-11-01', title: 'Первые каникулы' }] }
const days = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-11-02'].map(date => ({ date,
  schedule: [], homework: date === '2026-10-24' ? [{ subject: 'Литература', text: 'Читать' }] : [],
  dayToken: null, homeworkDayToken: null, complete: false, checkedAt: null })) as IndexedDay[]

describe('pupil calendar control', () => {
  it('keeps each vacation label inside its own independent date group', async () => {
    const host = document.createElement('div'), root = createRoot(host)
    const source = { ...calendar, vacations: [{ from: '2026-10-24', to: '2026-10-24', title: 'Первый период отдыха' },
      { from: '2026-11-02', to: '2026-11-02', title: 'Второй период отдыха' }] }
    try {
      await act(async () => root.render(<DayCalendar days={days} schoolCalendar={source} today="2026-10-24" selectedDate="2026-10-24" onSelect={() => {}} />))
      const groups = [...host.querySelectorAll('.day-dashboard-vacation')]
      expect(groups).toHaveLength(2)
      for (const [index, group] of groups.entries()) {
        const label = group.querySelector('.day-dashboard-vacation-label-track .day-dashboard-vacation-legend')
        expect(label).not.toBeNull()
        expect(label?.getAttribute('title')).toContain(source.vacations[index].title)
        expect(group.querySelector('[data-date]')?.getAttribute('data-date')).toBe(source.vacations[index].from)
      }
      expect(host.querySelector('.day-dashboard-heading .day-dashboard-vacation-legend')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })
  it('groups confirmed dates and keeps selection, today, keyboard buttons and homework', async () => {
    const host = document.createElement('div'), root = createRoot(host), onSelect = vi.fn()
    try {
      await act(async () => root.render(<DayCalendar days={days} schoolCalendar={calendar} today="2026-10-24" selectedDate="2026-10-25" onSelect={onSelect} />))
      expect(host.querySelectorAll('.day-dashboard-vacation')).toHaveLength(1)
      expect(host.querySelector('.day-dashboard-vacation .day-dashboard-vacation-heading')).toBeNull()
      expect(host.querySelector('.day-dashboard-heading .day-dashboard-vacation-legend')).toBeNull()
      expect(host.querySelector('.day-dashboard-vacation .day-dashboard-vacation-legend')?.textContent).toContain('Каникулы')
      expect(host.querySelector('.day-dashboard-vacation-legend')?.getAttribute('title')).toContain('24 окт. — 1 нояб.')
      expect(host.querySelector('.day-dashboard-vacation')?.getAttribute('aria-label')).toContain('24 окт. — 1 нояб.')
      expect(host.querySelectorAll('.day-dashboard-vacation button')).toHaveLength(2)
      expect(host.querySelector('[aria-current="date"]')?.getAttribute('data-date')).toBe('2026-10-24')
      expect(host.querySelector('[aria-pressed="true"]')?.getAttribute('data-date')).toBe('2026-10-25')
      expect(host.querySelector('[data-date="2026-10-24"]')?.textContent).toContain('1 ДЗ')
      await act(async () => host.querySelector<HTMLButtonElement>('[data-date="2026-11-02"]')!.click())
      expect(onSelect).toHaveBeenCalledWith('2026-11-02')
    } finally { await act(async () => root.unmount()) }
  })
  it('centers once, keeps mid-strip selection still, then smoothly reveals a selected edge date', async () => {
    const host = document.createElement('div'), root = createRoot(host)
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    try {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains('day-dashboard-dates')) return { left: 100, right: 900, width: 800 } as DOMRect
        const left = this.dataset.date === '2026-11-02' ? 820 : 500
        return { left, right: left + 68, width: 68 } as DOMRect
      })
      await act(async () => root.render(<DayCalendar days={days} schoolCalendar={calendar} today="2026-10-24" selectedDate="2026-10-25" onSelect={(date) => {
        host.dataset.selected = date
      }} />))
      const strip = host.querySelector<HTMLDivElement>('.day-dashboard-dates')!
      const scrollTo = vi.fn()
      Object.defineProperty(strip, 'scrollTo', { configurable: true, value: scrollTo })
      expect(strip.scrollLeft).toBe(34)
      await act(async () => root.render(<DayCalendar days={days} schoolCalendar={calendar} today="2026-10-24" selectedDate="2026-10-23" onSelect={() => {}} />))
      expect(scrollTo).not.toHaveBeenCalled()
      await act(async () => root.render(<DayCalendar days={days} schoolCalendar={calendar} today="2026-10-24" selectedDate="2026-11-02" onSelect={() => {}} />))
      expect(scrollTo).toHaveBeenCalledWith({ left: 388, behavior: 'smooth' })
      await act(async () => root.render(<DayCalendar days={[...days]} schoolCalendar={calendar} today="2026-10-24" selectedDate="2026-11-02" onSelect={() => {}} />))
      expect(scrollTo).toHaveBeenCalledTimes(1)
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
      await act(async () => root.unmount())
    }
  })
  it('uses each pupil’s source and never infers vacations from empty lessons or weekends', async () => {
    const host = document.createElement('div'), root = createRoot(host)
    try {
      for (const source of [undefined, { ...calendar, vacations: [] }, { ...calendar, vacations: [{ from: '2026-11-02', to: '2026-11-02', title: 'Другие каникулы' }] }]) {
        await act(async () => root.render(<DayCalendar days={days} schoolCalendar={source} today="2026-10-24" selectedDate="2026-10-24" onSelect={() => {}} />))
        expect(host.querySelectorAll('.day-dashboard-vacation button')).toHaveLength(source?.vacations.length ? 1 : 0)
        expect(host.querySelector('[data-date="2026-10-24"]')?.closest('.day-dashboard-vacation')).toBeNull()
        expect(host.querySelectorAll('button')).toHaveLength(4)
      }
    } finally { await act(async () => root.unmount()) }
  })
})
