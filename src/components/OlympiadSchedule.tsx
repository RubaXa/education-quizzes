/** @see ../../docs/decisions/olympiad-calendar-2026-10-31.md
 * @see ../../docs/shared/design/information-hierarchy.md */
import { useEffect, useState } from 'react'
import {CalendarDays,ExternalLink,ChevronDown} from 'lucide-react'
import { nextOlympiadEvent, olympiadDate, remainingTime, isDateOnly, type OlympiadCalendar } from '@/lib/olympiad/calendar'
import './OlympiadSchedule.css'
/** Calendar meaning stays shared by catalog and full page; only their hierarchy differs. */
export default function OlympiadSchedule({ calendar, compact = false }: { calendar?: OlympiadCalendar; compact?: boolean }) {
 const [now,setNow]=useState(Date.now)
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer)},[])
 if(!calendar)return null
 const next=nextOlympiadEvent(calendar,now)
 const reg=calendar.registrationClosesAt&&Date.parse(calendar.registrationClosesAt)<=now?'Регистрация завершена'
  :calendar.registrationOpensAt&&Date.parse(calendar.registrationOpensAt)>now?`Регистрация с ${olympiadDate(calendar.registrationOpensAt)}`:calendar.registrationNote
 const countdown=next&&(isDateOnly(next.at)?'Дата известна · точное время уточняется':Date.parse(next.at)<=now?next.until?`Идёт · осталось ${remainingTime(next.until,now)}`:'Начало уже было · время окончания не опубликовано':`Через ${remainingTime(next.at,now)}`)
 const absent=calendar.events.length?'Опубликованные сроки прошли. Подготовка и история сохраняются.':'Следующие даты ещё не опубликованы. Подготовку можно включить уже сейчас.'
 if(compact)return <div className="olympiad-schedule compact">{next?<div className="olympiad-deadline"><strong>{next.title}{next.provisional?' · предварительно':''}</strong><span>{olympiadDate(next.at)}{next.until?` — ${olympiadDate(next.until)}`:''}</span><b>{countdown}</b></div>:<p>{absent}</p>}<p>{reg}</p></div>
 return <div className="olympiad-schedule olympiad-schedule-full">
  {next?<section className="olympiad-next-event" aria-label="Ближайшая дата"><CalendarDays size={20} aria-hidden="true"/><div><h2>{next.title}</h2>{next.provisional&&<p className="olympiad-provisional">Предварительно</p>}<time dateTime={next.at}>{olympiadDate(next.at)}</time>{next.until&&<span className="olympiad-event-until">до {olympiadDate(next.until)}</span>}<span className="olympiad-countdown">{countdown}</span></div></section>:<section className="olympiad-next-event"><CalendarDays size={20} aria-hidden="true"/><div><h2>{calendar.statusLabel??'Следующие даты'}</h2><p>{absent}</p></div></section>}
  <section className="olympiad-registration-block" aria-label="Участие"><h2>Участие</h2><p>{reg}</p><a className="olympiad-registration" href={calendar.registrationUrl} target="_blank" rel="noopener noreferrer">{calendar.registrationLinkLabel??'Регистрация у организатора'}<ExternalLink size={16} aria-hidden="true"/></a><p className="olympiad-schedule-note">Подготовка в Education не заменяет регистрацию.</p></section>
  <div className="olympiad-information-details">
   <details><summary>Все даты и условия участия<ChevronDown size={16} aria-hidden="true"/></summary><div className="olympiad-information-body">{calendar.statusLabel&&next&&<p>{calendar.statusLabel}</p>}<h3>Регистрация</h3><p>{calendar.registrationNote}</p><p>Регистрацию у организатора нужно пройти отдельно.</p><ul className="olympiad-timeline">{calendar.events.map(event=><li key={event.id}><strong>{event.title}{event.provisional?' · предварительно':''}</strong><time dateTime={event.at}>{olympiadDate(event.at)}{event.until?` — ${olympiadDate(event.until)}`:''}</time><a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">Источник<ExternalLink size={14} aria-hidden="true"/></a></li>)}</ul>{calendar.notes.map(note=><p key={note}>{note}</p>)}<h3>Источники</h3><p>Сверено {new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow'}).format(new Date(calendar.checkedAt))}.</p><ul>{calendar.sources.map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ExternalLink size={14} aria-hidden="true"/></a></li>)}</ul></div></details>
   <details><summary>План подготовки<ChevronDown size={16} aria-hidden="true"/></summary><div className="olympiad-information-body"><p>Подготовка — дополнительная работа. Текущие конкурсные задачи выполняются по правилам организатора.</p><ol>{calendar.preparation.map(step=><li key={step}>{step}</li>)}</ol></div></details>
  </div>
 </div>
}
