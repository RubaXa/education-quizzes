import type {ResultInput} from './resultPresentation'
import type { Assignment, QuestionResult } from './quiz'
import { isCdzTask } from './dayStore'
import type { DayTask, DayTestPlacement } from './dayStore'

/** Stable read model shared by the day route and the personal test list.
 * @see ../../docs/modules/reviews/subject-card-viewmodel.md#projections */
export type QuizCardAttempt = {
  token: string; testId: string; linkedToTestId?: string | null; title: string; description?: string;
  slug: string; previewToken?: string; status: Assignment['status']; answered: number; total: number;
  points?: number; maxPoints?: number;
  /** Already graded under the same access policy as the full result; no row subscriptions. */
  results?: QuestionResult[];
  createdAt?: unknown; startedAt?: unknown; updatedAt?: unknown; submittedAt?: unknown;
  followupRequested?: boolean;
  familyOptional?: boolean; rootToken?: string;
}

export function quizResultInput(test: QuizCardAttempt): ResultInput {
  return test.status === 'submitted' ? test.points == null || test.maxPoints == null ? {kind:'waiting'} : {kind:'score',points:test.points,maxPoints:test.maxPoints}
    : {kind:'answers',answered:Math.min(test.answered,test.total),total:test.total}
}

/** Presentation order never mutates the causal chain or sorts by a late review update.
 * @see ../../docs/modules/assessments/quiz-chain-proposal.md */
export function quizTimestamp(value: unknown): number {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0
  if (typeof value === 'string' || typeof value === 'number') { const time = new Date(value).getTime(); return Number.isFinite(time) ? time : 0 }
  if (value && typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') return quizTimestamp(value.seconds * 1000)
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return quizTimestamp(value.toMillis())
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return quizTimestamp(value.toDate())
  return 0
}

export function quizHistoryNewestFirst(tests: QuizCardAttempt[]): QuizCardAttempt[] {
  return [...tests].sort((a,b) => (quizTimestamp(b.submittedAt) || quizTimestamp(b.createdAt)) - (quizTimestamp(a.submittedAt) || quizTimestamp(a.createdAt)) || (a.testId < b.testId ? -1 : a.testId > b.testId ? 1 : 0))
}

export function quizAnswerCounts(test: QuizCardAttempt) {
  if (!test.results) return undefined
  const counts = { correct: 0, partial: 0, incorrect: 0, unanswered: 0, pending: 0, excluded: 0 }
  for (const result of test.results) {
    if (result.skipped) counts.excluded++
    else if (result.points === null) counts.pending++
    else if (result.points === result.question.points) counts.correct++
    else if (result.answer === undefined || result.answer === '' || Array.isArray(result.answer) && !result.answer.length) counts.unanswered++
    else if (result.points > 0) counts.partial++
    else counts.incorrect++
  }
  return counts
}

/** A single check task and a single standalone quiz are one family self-check.
 * @see ../../docs/modules/school-diary/day-page.md#single-check-quiz */
export function quizTaskForPlacement(tasks: DayTask[], placements: DayTestPlacement[], placement: DayTestPlacement): DayTask | undefined {
  if (!placements.some((item) => item.token === placement.token)) return undefined
  if (placement.taskId) return tasks.find((task) => task.id === placement.taskId)
  if (placement.optional) return undefined
  return tasks.length === 1 && placements.length === 1 && tasks[0].kind === 'check' && !isCdzTask(tasks[0])
    && !tasks[0].testToken ? tasks[0] : undefined
}

/** One deterministic association serves the day, calendar, and parent home. */
export function withQuizPlacements(tasks: DayTask[], placements: DayTestPlacement[]): DayTask[] {
  return tasks.map((task) => {
    if (task.testToken) return task
    const placement = placements.find((item) => quizTaskForPlacement(tasks, placements, item)?.id === task.id)
    return placement ? { ...task, testToken: placement.token } : task
  })
}

export function quizChain(root: QuizCardAttempt | undefined, tests: QuizCardAttempt[]): QuizCardAttempt[] {
  if (!root) return []
  const chain = [root]
  const seen = new Set([root.testId])
  while (true) {
    const next = tests.find((test) => test.linkedToTestId === chain[chain.length - 1].testId && !seen.has(test.testId))
    if (!next) return chain
    chain.push(next)
    seen.add(next.testId)
  }
}

/** The board shows attempts separately, but the requirement belongs to the
 * oldest available assignment in their linked chain. */
export function quizRoot<T extends Pick<QuizCardAttempt, 'token' | 'testId' | 'linkedToTestId'>>(item: T, tests: T[]): T {
  const byTestId = new Map(tests.map((test) => [test.testId, test]))
  const seen = new Set([item.testId])
  let root = item
  while (root.linkedToTestId && !seen.has(root.linkedToTestId)) {
    const previous = byTestId.get(root.linkedToTestId)
    if (!previous) break
    root = previous
    seen.add(previous.testId)
  }
  return root
}

/** A linked quiz has one visible card at its root assignment, not an extra DOM card.
 * @see ../../docs/modules/school-diary/dashboard.md#schedule-homework-status */
export function findQuizPlacement<T extends { token: string }>(placements: T[], tests: QuizCardAttempt[], token: string): T | undefined {
  return placements.find((placement) => quizChain(tests.find((test) => test.token === placement.token), tests)
    .some((test) => test.token === token))
}
