/** @see ../../docs/decisions/canonical-evidence-and-learning-2026-11-17.md */
import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { DayProblem, DaySourceResearch } from '@/lib/dayStore'
import { compactProblemCardLabel, type ProblemCardState } from '@/lib/reviewPresentation'
import PhotoUploadControl from './PhotoUploadControl'
import StatusIcon from './StatusIcon'
import './ProblemCard.css'

/** One numbered problem shell; route-specific evidence stays in its children.
 * @see ../../docs/shared/design/components.md#registry
 * @see ../../docs/modules/reviews/adaptive-problem-card.md#shared-problem-view
 * @see ../../docs/shared/design/statuses.md#components */
/** @see ../../docs/modules/reviews/criteria-and-knowledge.md#scenarios */
export function ProblemCard({ problem, state, parent = false, sourceResearch, children,decision }: { problem: DayProblem; state: ProblemCardState; parent?: boolean; sourceResearch?: DaySourceResearch; children: ReactNode;decision?:{nodes:string[];edges:string[]} }) {
  const [sourceOpen, setSourceOpen] = useState(false)
  const status = state.tone === 'verified' ? 'complete' : state.tone === 'error' ? 'needs-fix'
    : state.tone === 'partial' ? 'partial' : state.tone === 'waiting' && state.label.includes('задержана') ? 'paused'
      : state.tone === 'waiting' && state.label.includes('неяс') ? 'unknown' : state.tone
  const compact = compactProblemCardLabel(state)
  const sourceStatus = sourceResearch?.status === 'verified' ? 'complete' : sourceResearch?.status === 'conflict' ? 'needs-fix' : 'unknown'
  const sourceLabel = sourceResearch?.status === 'verified' ? 'Источник подтверждён' : sourceResearch?.status === 'candidate' ? 'Возможный источник'
    : sourceResearch?.status === 'conflict' ? 'Источники расходятся' : sourceResearch?.status === 'not-found' ? 'Подтверждённый источник не найден' : 'Происхождение не проверено'
  const titleNumber = problem.title.trim().match(/^№\s*(\d+)(?:\s*[.:)]\s*|\s+|$)/)?.[1]
  const heading = titleNumber === String(problem.number) ? problem.title : `№ ${problem.number}. ${problem.title}`
  return <details className={`problem-card ${state.tone}`} id={problem.id} data-decision-nodes={decision?.nodes.join(' ')??'view.component'} data-decision-edges={decision?.edges.join(' ')} onToggle={(event) => { if (!event.currentTarget.open) setSourceOpen(false) }}>
    <summary className="problem-card-heading" aria-label={`${heading}. ${state.label}`}><strong>{heading}</strong><span className="problem-card-state" title={state.label}><StatusIcon status={status} size={15} />{compact && <small aria-hidden="true">{compact}</small>}</span>
      {parent && <span className="problem-card-source-wrap"><button type="button" className={`problem-card-source-trigger ${sourceStatus}`} aria-label={`${sourceLabel}. ${sourceOpen ? 'Скрыть' : 'Показать'} происхождение задачи`} aria-expanded={sourceOpen} aria-controls={sourceOpen ? `source-${problem.id}` : undefined} title={sourceLabel} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setSourceOpen((value) => !value) }} onKeyDown={(event) => event.stopPropagation()}><StatusIcon size={18} status={sourceStatus} /></button></span>}
      <ChevronDown size={17} className="problem-card-chevron" aria-hidden="true" />
      {parent && sourceOpen && <span className="problem-card-source-detail" id={`source-${problem.id}`} role="note" onClick={(event) => { event.stopPropagation(); if (!(event.target as HTMLElement).closest('a')) event.preventDefault() }}><strong>{sourceLabel}</strong><span>Исходник: {problem.source}</span>
          {sourceResearch ? <><span>{sourceResearch.title}</span><span>{sourceResearch.match}</span>{sourceResearch.url && <a href={sourceResearch.url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>Открыть источник ↗</a>}<small>Ключ: {sourceResearch.keyStatus === 'verified' ? 'сверен' : sourceResearch.keyStatus === 'candidate' ? 'кандидат требует сверки' : sourceResearch.keyStatus === 'unavailable' ? 'не найден' : 'не проверен'}. {sourceResearch.note}</small></>
            : <span>Поиск более раннего источника не записан.</span>}</span>}</summary>
    {children}
  </details>
}

export function ProblemUploadButton({ correction, onPhotos }: { correction: boolean; onPhotos: (files: File[]) => void }) {
  return <PhotoUploadControl className="problem-card-upload" label={correction ? 'Загрузить исправление' : 'Загрузить решение'} onPhotos={onPhotos} />
}
