/** @see ../../docs/product/assessment-decision-graph.md#followup-threshold */
export const QUIZ_PASS_PERCENT = 85

export function quizPassed(score?: { points: number; maxPoints: number } | null): boolean {
  return Boolean(score && Number.isFinite(score.points) && Number.isFinite(score.maxPoints)
    && score.maxPoints > 0 && score.points >= 0 && score.points * 100 >= QUIZ_PASS_PERCENT * score.maxPoints)
}

export function needsQuizFollowup(score: { points: number; maxPoints: number }, parentRequested = false): boolean {
  return score.maxPoints > 0 && (parentRequested || !quizPassed(score))
}

/** Every missed item gets a new check. A test shrinks only after a majority of
 * questions were correct; weak attempts reserve room for reinforcement,
 * confirmed strengths and transfer. The author must substantiate each slot. */
export function followupQuestionCount(originalCount: number, errorCount: number): number {
  if (!Number.isSafeInteger(originalCount) || originalCount < 1 || !Number.isSafeInteger(errorCount) || errorCount < 0 || errorCount > originalCount) throw new Error('Неверное число вопросов или ошибок.')
  if (errorCount === 0) return 0
  const reinforcement = Math.min(6, Math.ceil(errorCount * .3))
  const maintenance = Math.min(2, Math.max(1, Math.ceil(originalCount * .05)))
  const mixed = errorCount + reinforcement + maintenance + 1 // one transfer question
  const correctCount = originalCount - errorCount
  return correctCount > errorCount ? Math.min(100, mixed) : Math.max(originalCount, mixed)
}
