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
