import type { ReactNode } from 'react'
import { Camera, CheckCircle2, ChevronDown, CircleAlert, Clock3, LoaderCircle } from 'lucide-react'
import type { DayProblem } from '@/lib/dayStore'
import type { ProblemCardState } from '@/lib/reviewPresentation'
import './ProblemCard.css'

export function ProblemCard({ problem, state, children }: { problem: DayProblem; state: ProblemCardState; children: ReactNode }) {
  const icon = state.tone === 'verified' ? <CheckCircle2 size={15} aria-hidden="true" />
    : state.tone === 'uploading' || state.tone === 'processing' ? <LoaderCircle size={15} className="problem-card-spinning" aria-hidden="true" />
      : state.tone === 'error' ? <CircleAlert size={15} aria-hidden="true" />
        : state.tone === 'ready' ? null : <Clock3 size={15} aria-hidden="true" />
  return <details className={`problem-card ${state.tone}`} id={problem.id}>
    <summary className="problem-card-heading"><strong>№ {problem.number}. {problem.title}</strong><span className="problem-card-state">{icon}<small>{state.label}</small><ChevronDown size={17} className="problem-card-chevron" aria-hidden="true" /></span></summary>
    {children}
  </details>
}

export function ProblemUploadButton({ correction, onPhotos }: { correction: boolean; onPhotos: (files: File[]) => void }) {
  return <label className="problem-card-upload"><Camera size={17} aria-hidden="true" /> {correction ? 'Загрузить исправление' : 'Загрузить материал'}<input type="file" accept="image/*" multiple onChange={(event) => { onPhotos(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} /></label>
}
