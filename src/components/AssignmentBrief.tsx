import type { DayMaterialLink, DayTask } from '@/lib/dayStore'
import './AssignmentBrief.css'

/** Exact assignment text is the shared public part of the task ViewModel.
 * Provenance controls its label; textbook pages are supporting material.
 * Only a sourced assignment sets duties.
 * @see ../../docs/modules/reviews/card-generation-policy.md#shared-shell
 * @see ../../docs/modules/reviews/subject-card-viewmodel.md#projections
 * @see ../../docs/shared/design/README.md#cards-and-status */
/** @see ../../docs/decisions/family-essay-assignment-2026-10-20.md */
export default function AssignmentBrief({ task, materialLinks = [], compact = false }: { task: DayTask; materialLinks?: DayMaterialLink[]; compact?: boolean }) {
  const familyAssigned = task.familyOrigin?.sourceSystem === 'family'
  const exact = familyAssigned ? task.detail.trim() : task.meshText?.trim() || task.detail.trim()
  const hasTextbook = !familyAssigned && materialLinks.some((link) => link.sourceType === 'textbook-page')
  // @see ../../docs/modules/reviews/problem-card-design-decisions.md#flat-numbered-sheet
  // The assignment title already appears in ProblemGroup; keep the exact MESH
  // wording available without giving it a second prominent card.
  if (compact) return <details className="day-assignment-brief day-assignment-brief-compact">
    <summary>{familyAssigned ? 'Как назначено родителем' : 'Как задано учителем'}</summary>
    <p>{exact}</p>
    {hasTextbook && <small className="day-assignment-explanation">Страницы учебника — ниже. Объём задания определяет запись МЭШ.</small>}
  </details>
  return <div className="day-assignment-brief">
    <div className="day-assignment-brief-heading"><strong>{familyAssigned ? 'Подготовка Education' : 'Задание учителя'}</strong><span>{familyAssigned ? 'По просьбе родителя' : task.meshText ? 'МЭШ' : 'Источник уточняется'}</span></div>
    <p>{exact}</p>
    {hasTextbook && <small className="day-assignment-explanation">Страницы учебника — ниже. Объём задания определяет запись МЭШ.</small>}
  </div>
}
