import type { ResultInput } from '@/lib/resultPresentation'
import { resultNumber, resultPresentation } from '@/lib/resultPresentation'
import StatusIcon from '../StatusIcon'
import './result.css'

/** Canonical indicators, also rendered by the UI Kit. No reads, subscriptions or local palettes.
 * @see ../../../docs/modules/assessments/result-presentation-proposal.md */
export function ResultBadge({ input, showPoints = false, compact = false, className = '' }: { input: ResultInput; showPoints?: boolean; compact?: boolean; className?: string }) {
  const view = resultPresentation(input)
  return <span className={`edu-result-badge edu-result-tone-${view.tone} ${className}`.trim()} data-tone={view.tone} aria-label={input.kind === 'answers' ? `${input.answered ? 'В процессе' : 'Не начат'} · ${input.answered} из ${input.total} ответов` : undefined}>
    <StatusIcon status={view.status} size={14} /><span className={compact && view.value == null ? 'sr-only' : undefined}>{view.label}</span>{showPoints && view.points != null && <> · {resultNumber(view.points)} из {resultNumber(view.maxPoints!)} баллов</>}
  </span>
}

export function ResultPoints({ points, maxPoints, compact = false }: { points?: number; maxPoints?: number; compact?: boolean }) {
  const view = resultPresentation({ kind: 'score', points, maxPoints })
  return <span className={`edu-result-points edu-result-tone-${view.tone}`}>{view.value == null ? '—' : `${resultNumber(points!)}${compact ? '/' : ' / '}${resultNumber(maxPoints!)}`}</span>
}

export function ResultMeter({ input, label, compact = false }: { input: ResultInput; label: string; compact?: boolean }) {
  const view = resultPresentation(input)
  if (view.value == null) return null
  return <div className={`edu-result-meter edu-result-tone-${view.tone}${compact ? ' edu-result-meter-compact' : ''}`}
    role={input.kind === 'answers' ? 'progressbar' : 'meter'} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.value} aria-valuetext={view.label}>
    <span style={{ width: `${view.value}%` }} />
  </div>
}
