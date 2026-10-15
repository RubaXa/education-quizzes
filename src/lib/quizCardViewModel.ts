import type { Assignment } from './quiz'
import { isCdzTask } from './dayStore'
import type { DayTask, DayTestPlacement } from './dayStore'

/** Stable read model shared by the day route and the personal test list.
 * @see ../../docs/product/subject-card-viewmodel.md#projections */
export type QuizCardAttempt = {
  token: string; testId: string; linkedToTestId?: string | null; title: string; description?: string;
  slug: string; previewToken?: string; status: Assignment['status']; answered: number; total: number;
  points?: number; maxPoints?: number;
  followupRequested?: boolean;
  familyOptional?: boolean; rootToken?: string;
}

/** A single check task and a single standalone quiz are one family self-check.
 * @see ../../docs/product/day-page.md#single-check-quiz */
export function quizTaskForPlacement(tasks: DayTask[], placements: DayTestPlacement[], placement: DayTestPlacement): DayTask | undefined {
  if (!placements.some((item) => item.token === placement.token)) return undefined
  if (placement.taskId) return tasks.find((task) => task.id === placement.taskId)
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
 * @see ../../docs/product/dashboard.md#schedule-homework-status */
export function findQuizPlacement<T extends { token: string }>(placements: T[], tests: QuizCardAttempt[], token: string): T | undefined {
  return placements.find((placement) => quizChain(tests.find((test) => test.token === placement.token), tests)
    .some((test) => test.token === token))
}
