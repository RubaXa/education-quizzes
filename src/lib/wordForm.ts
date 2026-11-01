/** @see ../../docs/decisions/quiz-runner-kit-audit-2026-11-01.md */
/** @see ../../docs/modules/assessments/quizzes.md */
export function wordForm(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(count) % 100
  const last = n % 10
  if (!Number.isInteger(count) || (n >= 11 && n <= 14)) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}
