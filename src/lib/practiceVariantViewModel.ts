/** @see ../../docs/decisions/collapsed-variant-status-2026-10-21.md */
import type { DayProblem, DayUpload, DayWorkReview } from './dayStore'
import { parentAccepted } from './parentCompletion'
import type { ParentCompletionEvent } from './parentCompletion'
import { summarizeProblemGroup } from './problemGroupSummary'

/** @see ../../docs/modules/school-diary/day-page.md#completed-problem-group */
export type PracticeVariantView = { total: number; completed: number; verified: number; accepted: number; needsFix: number; partial: number; label: string; status: 'verified' | 'accepted' | 'needs-fix' | 'partial' | 'in-progress' | 'not-started' }

/** Collapsed header projection of actual review states; requirement is deliberately not an input. */
export function practiceVariantView(problems: DayProblem[], reviews: DayWorkReview[], uploads: DayUpload[] = [], decisions: ParentCompletionEvent[] = [], localPendingCount = 0, ready = true): PracticeVariantView {
  const summary = summarizeProblemGroup(problems, uploads, reviews, localPendingCount, ready, decisions)
  const reviewFor = (problem: DayProblem) => reviews.find(review => review.taskId === problem.id)
  const statuses = problems.map(problem => reviewFor(problem)?.status)
  const accepted = problems.filter(problem => parentAccepted(reviewFor(problem), decisions)
    && summarizeProblemGroup([problem], uploads, reviews, 0, true, decisions).completedCount === 1).length
  const completed = summary.completedCount
  const verified = Math.max(0, completed - accepted)
  const needsFix = summary.needsFixCount
  const partial = summary.partialCount
  const started = statuses.filter(Boolean).length
  const status = !ready ? 'in-progress' : summary.activeCount ? 'in-progress' : needsFix ? 'needs-fix' : partial ? 'partial' : completed === problems.length && accepted ? 'accepted' : verified === problems.length && problems.length ? 'verified' : started ? 'in-progress' : 'not-started'
  const statusLabel = status === 'needs-fix' ? 'Исправить' : status === 'partial' ? 'Часть сделана' : status === 'accepted' ? 'Засчитано' : status === 'verified' ? 'Проверено' : status === 'in-progress' ? 'Проверяется' : 'Не начато'
  return { total: problems.length, completed, verified, accepted, needsFix, partial, status, label: problems.length === 1 ? statusLabel : `${completed} из ${problems.length} · ${statusLabel}` }
}
