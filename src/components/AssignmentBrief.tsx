import type { DayMaterialLink, DayTask } from '@/lib/dayStore'
import './AssignmentBrief.css'

/** Exact teacher instruction is the shared public part of the task ViewModel.
 * Textbook pages are supporting material; only the sourced assignment sets duties.
 * @see ../../docs/product/card-generation-policy.md#shared-shell
 * @see ../../docs/product/design-system.md#cards-and-status */
export default function AssignmentBrief({ task, materialLinks = [] }: { task: DayTask; materialLinks?: DayMaterialLink[] }) {
  const exact = task.meshText?.trim() || task.detail.trim()
  const hasTextbook = materialLinks.some((link) => link.sourceType === 'textbook-page')
  return <div className="day-assignment-brief">
    <div className="day-assignment-brief-heading"><strong>Задание учителя</strong><span>{task.meshText ? 'МЭШ' : 'Источник уточняется'}</span></div>
    <p>{exact}</p>
    {hasTextbook && <small className="day-assignment-explanation">Страницы учебника — ниже. Объём задания определяет запись МЭШ.</small>}
  </div>
}
