import type { DayMaterialLink, DayTask } from '@/lib/dayStore'
import './AssignmentBrief.css'

/** Exact teacher instruction is the shared public part of the task ViewModel.
 * Textbook pages are supporting material; only the sourced assignment sets duties.
 * @see ../../docs/modules/reviews/card-generation-policy.md#shared-shell
 * @see ../../docs/shared/design/README.md#cards-and-status */
export default function AssignmentBrief({ task, materialLinks = [], compact = false }: { task: DayTask; materialLinks?: DayMaterialLink[]; compact?: boolean }) {
  const exact = task.meshText?.trim() || task.detail.trim()
  const hasTextbook = materialLinks.some((link) => link.sourceType === 'textbook-page')
  // @see ../../docs/modules/reviews/problem-card-design-decisions.md#flat-numbered-sheet
  // The assignment title already appears in ProblemGroup; keep the exact MESH
  // wording available without giving it a second prominent card.
  if (compact) return <details className="day-assignment-brief day-assignment-brief-compact">
    <summary>Как задано учителем</summary>
    <p>{exact}</p>
    {hasTextbook && <small className="day-assignment-explanation">Страницы учебника — ниже. Объём задания определяет запись МЭШ.</small>}
  </details>
  return <div className="day-assignment-brief">
    <div className="day-assignment-brief-heading"><strong>Задание учителя</strong><span>{task.meshText ? 'МЭШ' : 'Источник уточняется'}</span></div>
    <p>{exact}</p>
    {hasTextbook && <small className="day-assignment-explanation">Страницы учебника — ниже. Объём задания определяет запись МЭШ.</small>}
  </div>
}
