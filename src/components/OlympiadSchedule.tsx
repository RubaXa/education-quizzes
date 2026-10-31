/** @see ../../docs/decisions/olympiad-calendar-2026-10-31.md */
import { useEffect, useState } from 'react'
import { nextOlympiadEvent, olympiadDate, remainingTime, type OlympiadCalendar } from '@/lib/olympiad/calendar'
import './OlympiadSchedule.css'
/** Same calendar on the catalog and detail page; the clock never changes participation.
 * @see ../../docs/modules/assessments/olympiad-preparation.md */
export default function OlympiadSchedule({ calendar, compact = false }: { calendar?: OlympiadCalendar; compact?: boolean }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  if (!calendar) return null
  const next = nextOlympiadEvent(calendar, now)
  const reg = calendar.registrationClosesAt && Date.parse(calendar.registrationClosesAt) <= now ? 'Регистрация завершена'
    : calendar.registrationOpensAt && Date.parse(calendar.registrationOpensAt) > now ? `Регистрация с ${olympiadDate(calendar.registrationOpensAt)}` : calendar.registrationNote
  return <div className={`olympiad-schedule${compact ? ' compact' : ''}`}>
    {next ? <div className="olympiad-deadline"><strong>{next.title}{next.provisional ? ' · предварительно' : ''}</strong><span>{olympiadDate(next.at)}{next.until ? ` — ${olympiadDate(next.until)}` : ''}</span><b>{Date.parse(next.at) <= now ? next.until ? `Идёт · осталось ${remainingTime(next.until, now)}` : 'Начало уже было · время окончания не опубликовано' : `Через ${remainingTime(next.at, now)}`}</b></div> : <p>Опубликованные сроки прошли. Подготовка и история сохраняются.</p>}
    <p>{reg}</p>
    {!compact && <><a className="olympiad-registration" href={calendar.registrationUrl} target="_blank" rel="noopener noreferrer">Регистрация у организатора ↗</a>
      <p className="olympiad-schedule-note">Тумблер включает подготовку в Education. Регистрацию у организатора нужно пройти отдельно.</p>
      <details><summary>Все даты и условия участия</summary><ul className="olympiad-timeline">{calendar.events.map(event => <li key={event.id}><strong>{event.title}{event.provisional ? ' · предварительно' : ''}</strong><span>{olympiadDate(event.at)}{event.until ? ` — ${olympiadDate(event.until)}` : ''}</span><a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">Источник ↗</a></li>)}</ul>{calendar.notes.map(note => <p key={note}>{note}</p>)}<p>Сверено {new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' }).format(new Date(calendar.checkedAt))}. Все часы указаны по Москве.</p>{calendar.sources.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a></p>)}</details>
      <section aria-label="С чего начать подготовку"><h2>С чего начать</h2><ol>{calendar.preparation.map(step => <li key={step}>{step}</li>)}</ol></section>
    </>}
  </div>
}
