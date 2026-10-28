import { useState } from 'react'
import { Button } from '@/components/ui/button'
import StatusIcon from './StatusIcon'
import type { OlympiadCatalogItem } from '@/lib/olympiad/client'
import '../DayDashboard.css'

/** Read-only projection from the authorized family service; caller owns navigation and writes.
 * @see ../../docs/modules/assessments/olympiad-preparation.md#назначение-и-границы */
export default function OlympiadCatalog({ items, parent, onOpen, onParticipation, onExpand, heading = 'Олимпиады' }: { items: OlympiadCatalogItem[]; parent: boolean; onOpen: (id: string) => void; onExpand?: (open: boolean) => void; onParticipation?: (id: string, enabled: boolean) => Promise<void>; heading?: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState(false)
  if (!items.length) return null
  async function toggle(item: OlympiadCatalogItem) {
    if (busy) return
    setBusy(item.id);setError(false)
    try { await onParticipation?.(item.id, !item.participationEnabled) } catch { setError(true) } finally { setBusy(null) }
  }
  return <section className="day-dashboard-card" aria-label={heading}><details onToggle={event=>{if(event.target===event.currentTarget)onExpand?.(event.currentTarget.open)}}><summary><strong>{heading} · {items.length}</strong></summary>
    {items.map(item=><div key={item.id} className="day-dashboard-homework-group"><h3>{item.title}</h3><p>{item.deadline ? `Срок: ${item.deadline}` : 'Даты уточняются'}</p><p><StatusIcon status={item.participationEnabled ? 'complete' : 'ready'} size={14} /> {onParticipation ? (item.participationEnabled ? 'Подготовка включена' : 'Подготовка не включена') : item.participationEnabled ? 'Практика доступна' : 'Подготовка ещё не подключена'}</p>
      {parent && item.eligibility === 'unknown' && <p>Класс ребёнка ещё не подтверждён.</p>}
      {parent && onParticipation && <Button variant="outline" disabled={busy !== null || (!item.participationEnabled && item.eligibility === 'unknown')} aria-pressed={item.participationEnabled} onClick={()=>void toggle(item)}>{item.participationEnabled ? 'Выключить подготовку' : 'Включить подготовку'}</Button>}
      {item.participationEnabled && <Button variant="outline" onClick={()=>onOpen(item.id)}>Открыть подготовку</Button>}
    </div>)}
    {error && <p role="alert">Не удалось изменить участие. Попробуйте ещё раз.</p>}
  </details></section>
}
