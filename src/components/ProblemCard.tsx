import type { ReactNode } from 'react'
import { CheckCircle2, ChevronDown, CircleAlert, Clock3, LoaderCircle } from 'lucide-react'
import type { DayProblem } from '@/lib/dayStore'
import { compactProblemCardLabel, type ProblemCardState } from '@/lib/reviewPresentation'
import PhotoUploadControl from './PhotoUploadControl'
import './ProblemCard.css'

/** One numbered problem shell; route-specific evidence stays in its children.
 * @see ../../docs/product/component-system.md#registry
 * @see ../../docs/product/adaptive-problem-card.md#shared-problem-view */
export function ProblemCard({ problem, state, children }: { problem: DayProblem; state: ProblemCardState; children: ReactNode }) {
  const icon = state.tone === 'verified' ? <CheckCircle2 size={15} aria-hidden="true" />
    : state.tone === 'uploading' || state.tone === 'processing' ? <LoaderCircle size={15} className="problem-card-spinning" aria-hidden="true" />
      : state.tone === 'error' ? <CircleAlert size={15} aria-hidden="true" />
        : state.tone === 'ready' ? null : <Clock3 size={15} aria-hidden="true" />
  return <details className={`problem-card ${state.tone}`} id={problem.id}>
    <summary className="problem-card-heading"><strong>№ {problem.number}. {problem.title}</strong><span className="problem-card-state" aria-label={state.label} title={state.label}>{icon}<small aria-hidden="true">{compactProblemCardLabel(state)}</small><ChevronDown size={17} className="problem-card-chevron" aria-hidden="true" /></span></summary>
    {children}
  </details>
}

export function ProblemUploadButton({ correction, onPhotos }: { correction: boolean; onPhotos: (files: File[]) => void }) {
  return <PhotoUploadControl className="problem-card-upload" label={correction ? 'Добавить фото исправления' : 'Добавить фото решения'} onPhotos={onPhotos} />
}
