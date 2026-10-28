/** @see ../../docs/modules/school-diary/school-calendar.md#представление */
/** @see ../../docs/decisions/pupil-vacations-2026-10-19.md */
/** @see ../../docs/decisions/calendar-fixed-height-2026-10-19.md */
/** @see ../../docs/decisions/calendar-vacation-sticky-2026-10-19.md */
/** @see ../../docs/decisions/calendar-scroll-selection-2026-10-28.md */
/** @see ../../docs/shared/design/README.md#tokens */
/** @see ../../docs/shared/design/ui-kit.md#один-источник-реализации */
/** @see ../../docs/shared/design/components.md#registry */
import { useEffect, useRef } from 'react'
import { CalendarDays, Sun } from 'lucide-react'
import type { IndexedDay } from '@/lib/dayDashboardStore'
import { schoolCalendarGroups } from '../../day/school-calendar.mjs'
import type { SchoolCalendar, Vacation } from '../../day/school-calendar.mjs'
import { calendarScrollTarget } from './dayCalendarScroll'
import '../DayDashboard.css'

function dateLabel(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`))
}
export function vacationRange(vacation: Vacation) {
  const options = { day: 'numeric', month: 'short' } as const
  return vacation.from === vacation.to ? dateLabel(vacation.from, options) : `${dateLabel(vacation.from, options)} — ${dateLabel(vacation.to, options)}`
}
export default function DayCalendar({ days, schoolCalendar, today, selectedDate, onSelect }: {
  days: IndexedDay[]; schoolCalendar?: SchoolCalendar; today: string; selectedDate: string;
  onSelect: (date: string) => void
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  const initialPositionSet = useRef(false)
  const previousSelection = useRef(selectedDate)
  useEffect(() => {
    const strip = stripRef.current
    const active = strip?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!strip || !active) return
    const initial = !initialPositionSet.current
    if (!initial && previousSelection.current === selectedDate) return
    const stripRect = strip.getBoundingClientRect()
    const activeRect = active.getBoundingClientRect()
    const target = calendarScrollTarget({
      scrollLeft: strip.scrollLeft,
      viewportLeft: stripRect.left,
      viewportRight: stripRect.right,
      dayLeft: activeRect.left,
      dayRight: activeRect.right,
      dayWidth: activeRect.width,
      initial,
    })
    initialPositionSet.current = true
    previousSelection.current = selectedDate
    if (target === null || Math.abs(target - strip.scrollLeft) < 1) return
    if (initial) strip.scrollLeft = target
    else strip.scrollTo({ left: target, behavior: 'smooth' })
  }, [days, selectedDate])
  const groups = schoolCalendarGroups(days, schoolCalendar)
  function renderDay(day: IndexedDay, vacation?: Vacation) {
    const weekend = [0, 6].includes(new Date(`${day.date}T12:00:00Z`).getUTCDay())
    return <button key={day.date} data-date={day.date} type="button"
      className={`day-dashboard-date ${day.date === today ? 'today' : ''} ${day.date === selectedDate ? 'selected' : ''} ${weekend ? 'weekend' : ''}`}
      aria-label={vacation ? `${dateLabel(day.date, { day: 'numeric', month: 'long' })} · ${vacation.title}, каникулы по МЭШ` : undefined}
      aria-current={day.date === today ? 'date' : undefined} aria-pressed={day.date === selectedDate} onClick={() => onSelect(day.date)}>
      <span>{dateLabel(day.date, { weekday: 'short' })}</span><strong>{dateLabel(day.date, { day: 'numeric' })}</strong>
      <small>{day.homework.length ? `${day.homework.length} ДЗ` : day.schedule.length ? 'уроки' : '—'}</small>
    </button>
  }
  return <section className="day-dashboard-calendar" aria-label="Выбор дня">
    <div className="day-dashboard-heading"><div><CalendarDays size={20} /><h2>Выберите день</h2></div></div>
    <div className="day-dashboard-dates" ref={stripRef}>{groups.map(group => group.vacation
      ? <div className="day-dashboard-vacation" key={group.days[0].date} role="group" title={`${group.vacation.title}: ${vacationRange(group.vacation)}`} aria-label={`${group.vacation.title}: ${vacationRange(group.vacation)} · МЭШ`}>
        <div className="day-dashboard-vacation-label-track"><span className="day-dashboard-vacation-legend" title={`${group.vacation.title}: ${vacationRange(group.vacation)} · МЭШ`}><Sun size={13} aria-hidden="true" /><span>Каникулы</span><span className="day-dashboard-vacation-range">{vacationRange(group.vacation)}</span></span></div>
        <div className="day-dashboard-vacation-days">{group.days.map(day => renderDay(day, group.vacation))}</div>
      </div> : renderDay(group.days[0]))}</div>
  </section>
}
