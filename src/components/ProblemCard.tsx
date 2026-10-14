import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { DayProblem } from '@/lib/dayStore'
import { compactProblemCardLabel, type ProblemCardState } from '@/lib/reviewPresentation'
import PhotoUploadControl from './PhotoUploadControl'
import StatusIcon from './StatusIcon'
import './ProblemCard.css'

/** One numbered problem shell; route-specific evidence stays in its children.
 * @see ../../docs/product/component-system.md#registry
 * @see ../../docs/product/adaptive-problem-card.md#shared-problem-view
 * @see ../../docs/product/status-presentation.md#components */
export function ProblemCard({ problem, state, children }: { problem: DayProblem; state: ProblemCardState; children: ReactNode }) {
  const status = state.tone === 'verified' ? 'complete' : state.tone === 'error' ? 'needs-fix'
    : state.tone === 'partial' ? 'partial' : state.tone === 'waiting' && state.label.includes('задержана') ? 'paused'
      : state.tone === 'waiting' && state.label.includes('неяс') ? 'unknown' : state.tone
  const compact = compactProblemCardLabel(state)
  return <details className={`problem-card ${state.tone}`} id={problem.id}>
    <summary className="problem-card-heading" aria-label={`№ ${problem.number}. ${problem.title}. ${state.label}`}><strong>№ {problem.number}. {problem.title}</strong><span className="problem-card-state" title={state.label}><StatusIcon status={status} size={15} />{compact && <small aria-hidden="true">{compact}</small>}<ChevronDown size={17} className="problem-card-chevron" aria-hidden="true" /></span></summary>
    {children}
  </details>
}

export function ProblemUploadButton({ correction, onPhotos }: { correction: boolean; onPhotos: (files: File[]) => void }) {
  return <PhotoUploadControl className="problem-card-upload" label={correction ? 'Добавить фото исправления' : 'Добавить фото решения'} onPhotos={onPhotos} />
}
