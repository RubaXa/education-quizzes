import type { DayDashboardData, IndexedDay } from './dayDashboardStore'

const zone = 'Europe/Moscow'
const moscowDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)

/** The parent overview follows the child's first actual lesson, not midnight.
 * Stale lessons from another date cannot advance the card.
 * @see ../../docs/modules/school-diary/dashboard.md#parent-focus-day
 */
export function parentFocusDay(index: DayDashboardData | null, now: Date): IndexedDay | null {
  if (!index) return null
  const today = moscowDate(now)
  const current = index.days.find((day) => day.date === today)
  const firstLesson = current?.schedule
    .map((lesson) => new Date(lesson.start))
    .filter((start) => Number.isFinite(start.getTime()) && moscowDate(start) === today)
    .sort((a, b) => a.getTime() - b.getTime())[0]
  const earliestDate = firstLesson && now.getTime() >= firstLesson.getTime()
    ? new Date(`${today}T12:00:00Z`).getTime() + 86_400_000 : null
  const from = earliestDate === null ? today : new Date(earliestDate).toISOString().slice(0, 10)
  const upcoming = index.days.filter((day) => day.date >= from).sort((a, b) => a.date.localeCompare(b.date))
  return upcoming.find((day) => day.schedule.length > 0) ?? upcoming.find((day) => day.homework.length > 0) ?? null
}
