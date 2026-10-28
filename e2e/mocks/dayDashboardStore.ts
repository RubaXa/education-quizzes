/** @see ../../docs/modules/school-diary/school-calendar.md#представление */
import type { DayDashboardData } from '../../src/lib/dayDashboardStore'

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function addDays(date: string, count: number) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + count)
  return value.toISOString().slice(0, 10)
}
function dashboard(token: string): DayDashboardData {
  const kind = token === 'e2e-parent' ? 'parent' : 'student'
  const center = today()
  const start = addDays(center, -23)
  return {
    schemaVersion: 1,
    kind,
    today: center,
    timezone: 'Europe/Moscow',
    // Reproduce an offline/stale published index like the user's screenshot:
    // its last date is almost two weeks behind today.
    days: Array.from({ length: 12 }, (_, index) => ({
      date: addDays(start, index), checkedAt: null, complete: true,
      schedule: [], homework: [], dayToken: null,
    })),
  }
}

export function readCachedDayDashboard() { return null }
export function watchDayDashboard(token: string, onChange: (value: DayDashboardData) => void) {
  let active = true
  queueMicrotask(() => { if (active) onChange(dashboard(token)) })
  return () => { active = false }
}
export function clearCachedDayDashboard() {}
