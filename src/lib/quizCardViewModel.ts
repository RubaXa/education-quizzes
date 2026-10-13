import type { Assignment } from './quiz'

/** Stable read model shared by the day route and the personal test list.
 * @see ../../docs/product/subject-card-viewmodel.md#projections */
export type QuizCardAttempt = {
  token: string; testId: string; linkedToTestId?: string | null; title: string; description?: string;
  slug: string; previewToken?: string; status: Assignment['status']; answered: number; total: number;
  points?: number; maxPoints?: number;
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

/** A linked quiz has one visible card at its root assignment, not an extra DOM card.
 * @see ../../docs/product/dashboard.md#schedule-homework-status */
export function findQuizPlacement<T extends { token: string }>(placements: T[], tests: QuizCardAttempt[], token: string): T | undefined {
  return placements.find((placement) => quizChain(tests.find((test) => test.token === placement.token), tests)
    .some((test) => test.token === token))
}
