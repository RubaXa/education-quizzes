/** @see ../../docs/decisions/collapsed-variant-status-2026-10-21.md */
import StatusIcon from './StatusIcon'
import { practiceVariantView } from '@/lib/practiceVariantViewModel'
import type { DayProblem, DayUpload, DayWorkReview } from '@/lib/dayStore'
import type { ParentCompletionEvent } from '@/lib/parentCompletion'
import './PracticeVariantStatus.css'

/** @see ../../docs/modules/school-diary/day-page.md#completed-problem-group
 * @see ../../docs/shared/design/statuses.md#components */
/** Actual review summary for a collapsed teacher variant; requirement is presented by its sibling switch. */
export function PracticeVariantStatus({ problems, reviews, uploads, decisions, localPendingCount = 0, ready = true }: {
  problems: DayProblem[]; reviews: DayWorkReview[]; uploads: DayUpload[]; decisions: ParentCompletionEvent[]; localPendingCount?: number; ready?: boolean
}) {
  const view = practiceVariantView(problems, reviews, uploads, decisions, localPendingCount, ready)
  const icon = view.status === 'verified' || view.status === 'accepted' ? 'complete' : view.status === 'needs-fix' ? 'needs-fix' : view.status === 'partial' ? 'partial' : view.status === 'in-progress' ? 'waiting' : 'ready'
  return <span className="practice-variant-status" data-status={view.status} aria-label={`${view.label}; ${view.verified} проверено, ${view.accepted} засчитано родителем, ${view.needsFix} требуют исправления, ${view.partial} выполнено частично`}><StatusIcon size={15} status={icon} />{view.label}</span>
}
