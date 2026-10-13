import type { QuestionResult } from './quiz'

export type SpellingFeedback = { correct: string; detail: string; practice: string }

/** Shows the verified spelling only after a vocabulary dictation was submitted.
 * @see ../../docs/product/quizzes.md#quiz-results
 */
export function spellingFeedback(result: QuestionResult): SpellingFeedback | null {
  const { question, correctAnswer, answer } = result
  if (result.points !== 0 || question.kind !== 'short'
    || !/написан|диктант/i.test(question.topic ?? '')
    || typeof correctAnswer !== 'string' || !correctAnswer.trim()
    || (answer !== undefined && typeof answer !== 'string')) return null

  const correct = correctAnswer.trim()
  const actual = typeof answer === 'string' ? answer.trim() : ''
  let detail = 'Сравни своё слово с правильным написанием по буквам.'
  if (!actual) detail = 'Слово пропущено.'
  else {
    const wanted = correct.toLocaleLowerCase('en')
    const given = actual.toLocaleLowerCase('en')
    let left = 0
    while (left < wanted.length && left < given.length && wanted[left] === given[left]) left += 1
    let right = 0
    while (right < wanted.length - left && right < given.length - left
      && wanted[wanted.length - 1 - right] === given[given.length - 1 - right]) right += 1
    const missing = correct.slice(left, correct.length - right)
    const extra = actual.slice(left, actual.length - right)
    if (missing && extra && missing.length <= 2 && extra.length <= 2) {
      const place = left + 1 === correct.length ? 'в конце слова' : `после «${correct.slice(0, left)}»`
      detail = `У тебя «${extra}» вместо «${missing}» ${place}.`
    } else if (!missing && extra.length <= 2) {
      detail = `В твоём ответе лишняя «${extra}» после «${correct.slice(0, left)}».`
    } else if (!extra && missing.length <= 2) {
      detail = `Не хватает «${missing}» после «${correct.slice(0, left)}».`
    }
  }
  return {
    correct,
    detail,
    practice: 'Посмотри на слово, закрой образец и напиши его ещё раз по памяти.',
  }
}
