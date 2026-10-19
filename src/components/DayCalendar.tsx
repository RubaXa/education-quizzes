/** @see ../../docs/modules/school-diary/school-calendar.md#представление */
/** @see ../../docs/decisions/pupil-vacations-2026-10-19.md */
/** @see ../../docs/decisions/calendar-fixed-height-2026-10-19.md */
import type { Ref } from 'react'
import { CalendarDays, Sun } from 'lucide-react'
import type { IndexedDay } from '@/lib/dayDashboardStore'
import { schoolCalendarGroups } from '../../day/school-calendar.mjs'
import type { SchoolCalendar, Vacation } from '../../day/school-calendar.mjs'
import '../DayDashboard.css'

function dateLabel(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'Europe/Moscow' }).format(new Date(`${date}T12:00:00+03:00`))
}
export function vacationRange(vacation: Vacation) {
  const options = { day: 'numeric', month: 'short' } as const
  return vacation.from === vacation.to ? dateLabel(vacation.from, options) : `${dateLabel(vacation.from, options)} — ${dateLabel(vacation.to, options)}`
}
export default function DayCalendar({ days, schoolCalendar, today, selectedDate, onSelect, stripRef }: {
  days: IndexedDay[]; schoolCalendar?: SchoolCalendar; today: string; selectedDate: string;
  onSelect: (date: string) => void; stripRef?: Ref<HTMLDivElement>
}) {
  const groups = schoolCalendarGroups(days, schoolCalendar)
  const vacationDescription = groups.filter(group => group.vacation).map(group => `${group.vacation!.title}: ${vacationRange(group.vacation!)} · МЭШ`).join('; ')
  const vacationDates = groups.filter(group => group.vacation).map(group => vacationRange(group.vacation!)).join('; ')
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
    <div className="day-dashboard-heading"><div><CalendarDays size={20} /><h2>Выберите день</h2></div>
      {vacationDescription && <span className="day-dashboard-vacation-legend" title={vacationDescription} aria-label={vacationDescription}><Sun size={15} aria-hidden="true" /><span>Каникулы</span><span className="day-dashboard-vacation-range">{vacationDates}</span></span>}
    </div>
    <div className="day-dashboard-dates" ref={stripRef}>{groups.map(group => group.vacation
      ? <div className="day-dashboard-vacation" key={group.days[0].date} role="group" title={`${group.vacation.title}: ${vacationRange(group.vacation)}`} aria-label={`${group.vacation.title}: ${vacationRange(group.vacation)} · МЭШ`}>
        <div className="day-dashboard-vacation-days">{group.days.map(day => renderDay(day, group.vacation))}</div>
      </div> : renderDay(group.days[0]))}</div>
  </section>
}
