/** Private, deterministic history of linked attempts. Never publish raw answers.
 * @see ../docs/product/assessment-decision-graph.md#followup-threshold */
import { grade, summarize } from '../src/lib/quiz.ts'
import { followupQuestionCount } from '../src/lib/quizCompletion.ts'

export function quizLineageStatistics(attempts) {
  if (!Array.isArray(attempts) || !attempts.length) throw new Error('Нужна хотя бы одна попытка.')
  const topics = new Map()
  const history = attempts.map(({ assignment, answerKey, review }) => {
    if (assignment?.status !== 'submitted' || !answerKey?.entries) throw new Error('История содержит непроверенную попытку.')
    const results = grade(assignment, answerKey, review)
    const score = summarize(results)
    if (score.pending) throw new Error('История содержит непроверенные свободные ответы.')
    const items = results.map((result) => {
      const topic = result.question.topic?.trim() || 'Тема не указана'
      const outcome = result.skipped ? 'skipped' : result.points === result.question.points ? 'correct'
        : result.points > 0 ? 'partial' : 'incorrect'
      const record = topics.get(topic) ?? { topic, correct: 0, partial: 0, incorrect: 0, skipped: 0 }
      record[outcome]++
      topics.set(topic, record)
      return { questionId: result.question.id, topic, kind: result.question.kind, outcome,
        points: result.points, possible: result.question.points,
        selectedOptionIds: ['single', 'multiple', 'figure'].includes(result.question.kind)
          ? result.answer ?? null : null }
    })
    return { testId: assignment.testId, linkedToTestId: assignment.linkedToTestId ?? null,
      questionCount: items.length, earned: score.earned, possible: score.possible,
      incorrectQuestionIds: items.filter((item) => item.outcome === 'incorrect' || item.outcome === 'partial').map((item) => item.questionId),
      correctQuestionIds: items.filter((item) => item.outcome === 'correct').map((item) => item.questionId), items }
  })
  const current = history[0]
  return { schemaVersion: 1, attempts: history, topics: [...topics.values()].sort((a, b) => a.topic.localeCompare(b.topic, 'ru')),
    next: { sourceTestId: current.testId, errorQuestionIds: current.incorrectQuestionIds,
      targetCount: followupQuestionCount(current.questionCount, current.incorrectQuestionIds.length) } }
}
