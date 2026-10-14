/** @see ../../docs/product/assessment-decision-graph.md#followup-threshold */
export const QUIZ_PASS_PERCENT = 80

export function quizPassed(score?: { points: number; maxPoints: number } | null): boolean {
  return Boolean(score && Number.isFinite(score.points) && Number.isFinite(score.maxPoints)
    && score.maxPoints > 0 && score.points >= 0 && score.points * 100 >= QUIZ_PASS_PERCENT * score.maxPoints)
}

export function needsQuizFollowup(score: { points: number; maxPoints: number }, parentRequested = false): boolean {
  return score.maxPoints > 0 && (parentRequested || !quizPassed(score))
}

/** Every missed item gets one new check; the remaining slots mix older known
 * material with a fresh context. Near-total failure cannot shrink below errors. */
export function followupQuestionCount(originalCount: number, errorCount: number): number {
  if (!Number.isSafeInteger(originalCount) || originalCount < 1 || !Number.isSafeInteger(errorCount) || errorCount < 0 || errorCount > originalCount) throw new Error('Неверное число вопросов или ошибок.')
  if (errorCount === 0) return 0
  const mixed = errorCount + Math.ceil(errorCount * .3) + Math.min(3, Math.ceil(originalCount * .1))
  return Math.min(originalCount, Math.max(errorCount, Math.min(originalCount - 1, Math.max(mixed, Math.min(4, originalCount)))))
}
