// @vitest-environment jsdom
// @see ../../docs/product/dashboard.md#dashboard-warm-start
import { afterEach, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({ change: null as null | ((snapshot: any) => void) }))
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, token: string) => `${collection}/${token}`,
  onSnapshot: (_ref: unknown, _options: unknown, change: (snapshot: any) => void) => {
    probe.change = change; return () => { probe.change = null }
  },
}))

import { readCachedDayDashboard, watchDayDashboard } from './dayDashboardStore'

const index = (checkedAt: string) => ({ schemaVersion: 1, kind: 'parent', today: '2026-10-13', timezone: 'Europe/Moscow',
  days: [{ date: '2026-10-13', checkedAt, complete: true, schedule: [], homework: [], dayToken: null, homeworkDayToken: null }] })
const snapshot = (data: ReturnType<typeof index>, fromCache: boolean) => ({
  metadata: { fromCache }, exists: () => true, data: () => data,
})

afterEach(() => { probe.change = null; localStorage.clear() })

it('keeps the last published local calendar through an older SDK cache event, then accepts server data', () => {
  localStorage.setItem('education-day-dashboard-v1:calendar', JSON.stringify(index('2026-10-13T09:00:00.000Z')))
  const received: string[] = []
  const stop = watchDayDashboard('calendar', (data) => received.push(data.days[0].checkedAt ?? ''), () => {})
  probe.change?.(snapshot(index('2026-10-12T09:00:00.000Z'), true))
  expect(received).toEqual([])
  expect(readCachedDayDashboard('calendar', 'parent')?.days[0].checkedAt).toBe('2026-10-13T09:00:00.000Z')
  probe.change?.(snapshot(index('2026-10-13T10:00:00.000Z'), false))
  expect(received).toEqual(['2026-10-13T10:00:00.000Z'])
  stop()
})

it('can use the SDK disk cache on a cold device with no complete local projection', () => {
  const received: string[] = []
  watchDayDashboard('calendar', (data) => received.push(data.days[0].checkedAt ?? ''), () => {})
  probe.change?.(snapshot(index('2026-10-13T09:00:00.000Z'), true))
  expect(received).toEqual(['2026-10-13T09:00:00.000Z'])
})
