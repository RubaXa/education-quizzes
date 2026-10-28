import { useState } from 'react'
import { Button } from '@/components/ui/button'
import RequirementSwitch from './RequirementSwitch'
import SharedTabs from './SharedTabs'
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
  const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date())
  const available = items.filter(item => !(item.deadline && item.deadline < today))
  const archived = items.filter(item => item.participationEnabled && item.deadline && item.deadline < today)
  const active = items.filter(item => item.participationEnabled && !(item.deadline && item.deadline < today))
  const current = !parent && tab === 'available' ? 'active' : tab
  const tabs: Array<['active' | 'available' | 'archive', string]> = [['active', `Активные · ${active.length}`], ...(parent ? [['available', `Доступные · ${available.length}`] as ['available', string]] : []), ['archive', `Архив · ${archived.length}`]]
  const visible = current === 'active' ? active : current === 'available' ? available : archived
  async function toggle(item: OlympiadCatalogItem, next: boolean) {
    if (busy || !onParticipation) return
    setBusy(item.id); setError(false)
    try { await onParticipation(item.id, next) } catch { setError(true) } finally { setBusy(null) }
  }
  return <section className="day-dashboard-card" aria-label={heading}><details open onToggle={event => { if (event.target === event.currentTarget) onExpand?.(event.currentTarget.open) }}><summary><strong>{heading}</strong></summary>
    <SharedTabs label="Олимпиады" value={current} options={tabs.map(([id, label]) => ({ id, label }))} onChange={setTab} />
    {!visible.length && <p>{current === 'archive' ? 'Завершённых олимпиад пока нет.' : current === 'active' ? parent ? 'Пока нет активных олимпиад. Выберите их во вкладке «Доступные».' : 'Родитель ещё не включил олимпиады.' : 'Доступные олимпиады пока не опубликованы.'}</p>}
    {visible.map(item => <div key={item.id} className="day-dashboard-homework-group olympiad-catalog-row"><div className="olympiad-catalog-heading"><div><h3>{item.title}</h3>{item.subject && <p>{item.subject}</p>}{item.schedule && <p>{item.schedule}</p>}<p>{item.deadline ? `Срок: ${dateLabel(item.deadline)}` : 'Даты уточняются'}</p><p>История участия: данных пока нет</p></div>{parent && current === 'available' && <RequirementSwitch checked={item.participationEnabled} disabled={!onParticipation || busy !== null || (!item.participationEnabled && item.eligibility === 'unknown')} label={`Подготовка: ${item.title}`} onTitle="Выключить подготовку" offTitle="Включить подготовку" onChange={next => void toggle(item, next)} />}</div>
      {parent && item.eligibility === 'unknown' && <p>Класс ребёнка ещё не подтверждён.</p>}
      {current !== 'available' && (item.practiceAvailable !== false ? <Button variant="outline" onClick={() => onOpen(item.id)}>Открыть подготовку</Button> : <p>Материалы подготовки пока не опубликованы.</p>)}
    </div>)}
    {error && <p role="alert">Не удалось изменить участие. Попробуйте ещё раз.</p>}
  </details></section>
}
