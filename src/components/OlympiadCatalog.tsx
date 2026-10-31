import { useEffect, useState } from 'react'
import { BookOpen, ChevronRight } from 'lucide-react'
import RequirementSwitch from './RequirementSwitch'
import SharedTabs from './SharedTabs'
import OlympiadSchedule from './OlympiadSchedule'
import { olympiadEventExpired } from '@/lib/olympiad/calendar'
import '../DayPage.css'
import type { OlympiadCatalogItem } from '@/lib/olympiad/client'
import '../DayDashboard.css'

function dateLabel(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return match ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))) : date
}
/** Shared catalog: the parent selects, the learner sees selected work.
 * @see ../../docs/modules/assessments/olympiad-preparation.md#назначение-и-границы */
export default function OlympiadCatalog({ items, parent, onOpen, onParticipation, onExpand, heading = 'Олимпиады' }: { items: OlympiadCatalogItem[]; parent: boolean; onOpen: (id: string) => void; onExpand?: (open: boolean) => void; onParticipation?: (id: string, enabled: boolean) => Promise<void>; heading?: string }) {
  const [tab, setTab] = useState<'active' | 'available' | 'archive'>('active')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])
  const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date())
  const expired = (item: OlympiadCatalogItem) => item.calendar ? item.calendar.events.length > 0 && item.calendar.events.every(event => olympiadEventExpired(event, now)) : Boolean(item.deadline && item.deadline < today)
  const available = items.filter(item => !item.historicalOnly && !expired(item))
  const archived = items.filter(item => item.history || item.participationEnabled && expired(item))
  const active = items.filter(item => !item.historicalOnly && item.participationEnabled && !expired(item))
  const current = !parent && tab === 'available' ? 'active' : tab
  const tabs: Array<['active' | 'available' | 'archive', string]> = [['active', `Активные ${active.length}`], ...(parent ? [['available', `Доступные ${available.length}`] as ['available', string]] : []), ['archive', `Архив ${archived.length}`]]
  const visible = current === 'active' ? active : current === 'available' ? available : archived
  async function toggle(item: OlympiadCatalogItem, next: boolean) {
    if (busy || !onParticipation) return
    setBusy(item.id); setError(false)
    try { await onParticipation(item.id, next) } catch { setError(true) } finally { setBusy(null) }
  }
  return <section className="day-dashboard-card" aria-label={heading}><details open onToggle={event => { if (event.target === event.currentTarget) onExpand?.(event.currentTarget.open) }}><summary><strong>{heading}</strong></summary>
    <SharedTabs label="Олимпиады" value={current} options={tabs.map(([id, label]) => ({ id, label }))} onChange={setTab} />
    {!visible.length && <p>{current === 'archive' ? 'Завершённых олимпиад пока нет.' : current === 'active' ? parent ? 'Пока нет активных олимпиад. Выберите их во вкладке «Доступные».' : 'Родитель ещё не включил олимпиады.' : 'Доступные олимпиады пока не опубликованы.'}</p>}
    <div className="olympiad-catalog-list">{visible.map(item => <article key={item.id} className="day-dashboard-homework-row olympiad-catalog-row">
      <span className="day-dashboard-icon" aria-hidden="true"><BookOpen size={18} /></span>
      <button type="button" className="olympiad-card-link day-dashboard-homework-row-body" onClick={() => onOpen(item.id)} aria-label={`Открыть олимпиаду «${item.title}»`}>
        <strong>{item.title}</strong>
        {item.history && <span className="day-dashboard-homework-next">История · {item.history.summary}</span>}
        <span className="day-dashboard-homework-next">{[item.subject, item.schedule || (item.deadline ? `До ${dateLabel(item.deadline)}` : '')].filter(Boolean).join(' · ')}</span>
        {current !== 'available' && <span className="day-dashboard-homework-next">{item.practiceAvailable ? 'Подготовка доступна' : item.calendar?.preparation.length ? 'План подготовки доступен' : 'Материалы готовятся'}</span>}
      </button>
      {parent && current === 'available' ? <RequirementSwitch checked={item.participationEnabled} disabled={!onParticipation || busy !== null || (!item.participationEnabled && item.eligibility === 'unknown')} label={`Подготовка: ${item.title}`} onTitle="Выключить подготовку" offTitle="Включить подготовку" onChange={next => void toggle(item, next)} /> : <ChevronRight size={18} aria-hidden="true" />}
      {parent && current === 'available' && item.eligibility === 'unknown' && <small>Класс ребёнка ещё не подтверждён.</small>}
      <OlympiadSchedule calendar={item.calendar} compact />
    </article>)}</div>
    {error && <p role="alert">Не удалось изменить участие. Попробуйте ещё раз.</p>}
  </details></section>
}
