import type { EducationStatus } from '@/components/StatusIcon'
import { QUIZ_PASS_PERCENT } from './quizCompletion'

/** Shared meaning, independent of screen and subject. Never infer success from draft completion.
 * @see ../../docs/product/result-presentation-proposal.md */
export type ResultTone = 'success' | 'attention' | 'error' | 'waiting' | 'accent' | 'neutral'
export type ResultInput = { kind: 'score'; points?: number; maxPoints?: number }
  | { kind: 'answers'; answered: number; total: number }
  | { kind: 'waiting' } | { kind: 'unknown' }
export type ResultPresentation = { tone: ResultTone; status: EducationStatus; label: string; value?: number; points?: number; maxPoints?: number }
export const resultNumber = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)

export function resultPresentation(input: ResultInput): ResultPresentation {
  if (input.kind === 'waiting') return { tone: 'waiting', status: 'waiting', label: 'Ждёт проверки' }
  const unknown: ResultPresentation = { tone: 'neutral', status: 'unknown', label: 'Нет результата' }
  if (input.kind === 'unknown') return unknown
  if (input.kind === 'answers') {
    if (!Number.isSafeInteger(input.answered) || !Number.isSafeInteger(input.total) || input.total <= 0 || input.answered < 0 || input.answered > input.total) return unknown
    return { tone: input.answered ? 'accent' : 'neutral', status: input.answered ? 'started' : 'ready', label: `${input.answered} из ${input.total}`, value: 100 * input.answered / input.total }
  }
  const { points, maxPoints } = input
  if (points == null || maxPoints == null || !Number.isFinite(points) || !Number.isFinite(maxPoints) || maxPoints <= 0 || points < 0 || points > maxPoints) return unknown
  const value = 100 * points / maxPoints
  const tone = points * 100 >= maxPoints * QUIZ_PASS_PERCENT ? 'success' : points * 100 >= maxPoints * 50 ? 'attention' : 'error'
  const rounded = Math.round(value)
  // A rounded label must not cross either semantic threshold, or imply perfect performance.
  const crosses = (rounded >= 85) !== (value >= 85) || (rounded >= 50) !== (value >= 50) || rounded === 100 && points < maxPoints
  const percent = crosses ? resultNumber(Math.floor(value * 100) / 100) : String(rounded)
  return { tone, status: tone === 'success' ? 'complete' : tone === 'attention' ? 'partial' : 'incorrect', label: `${percent}%`, value, points, maxPoints }
}
