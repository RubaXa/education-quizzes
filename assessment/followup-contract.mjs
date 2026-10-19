/** Content-independent safeguards for a linked quiz and an unopened revision.
 * @see ../docs/modules/assessments/assessment-decision-graph.md#followup-threshold
 * @see ../docs/modules/assessments/quiz-chain-proposal.md#связь-с-кодом-и-проверками */
import { isDeepStrictEqual } from 'node:util'
import { publishedAnswer } from './question-guidance.mjs'
export function assertFollowupCoverage(plan, spec, sourceTestId, errorQuestionIds) {
  const coverage = plan?.followupCoverage
  if (coverage?.sourceTestId !== sourceTestId || !Array.isArray(coverage.errors)) {
    throw new Error('Закрытый план должен связать каждую ошибку с исходным testId.')
  }
  const expected = new Set(errorQuestionIds)
  const seen = new Set()
  const newIds = new Set(spec.questions.map((question) => question.id))
  const used = new Set()
  for (const item of coverage.errors) {
    if (!expected.has(item?.sourceQuestionId) || seen.has(item.sourceQuestionId)
      || !Array.isArray(item.newQuestionIds) || !item.newQuestionIds.length) {
      throw new Error('Покрытие ошибок содержит чужой, повторный или непроверенный пункт.')
    }
    seen.add(item.sourceQuestionId)
    for (const id of item.newQuestionIds) {
      if (!newIds.has(id) || used.has(id)) throw new Error('Одна новая проверка не может заменять две разные ошибки.')
      used.add(id)
    }
  }
  if (seen.size !== expected.size) throw new Error('Не каждая ошибка исходной попытки получила новую проверку.')
  if (!spec.questions.some((question) => plan.items.find((item) => item.questionId === question.id)?.layer === 'transfer')) {
    throw new Error('В продолжении нужен новый контекст на перенос.')
  }
  return { coveredErrors: seen.size, distinctChecks: used.size }
}

export function openQuizRevision({ current, spec, owner, revisedAt }) {
  if (current?.status !== 'open' || Object.keys(current.answers ?? {}).length
    || current.startedAt || current.updatedAt || current.submittedAt) {
    throw new Error('Изменять можно только открытый тест без сохранённых ответов.')
  }
  if (current.familyId !== owner.familyId || current.childId !== owner.childId
    || current.linkedToTestId !== spec.linkedToTestId || current.slug !== spec.slug
    || current.subject !== spec.subject) {
    throw new Error('Ревизия не может сменить владельца, исходный тест, предмет или ссылку.')
  }
  const questions = spec.questions.map(({ answer: _answer, ...question }) => question)
  return {
    assignment: { title: spec.title, description: spec.description, visual: spec.visual ?? null,
      reading: spec.reading ?? null, questions, revisedAt },
    answerKey: { entries: Object.fromEntries(spec.questions.map((question) => [question.id, publishedAnswer(question.answer)])) },
    preview: { title: spec.title, description: spec.description, visual: spec.visual ?? null,
      reading: spec.reading ?? null, questions, revisedAt },
    index: { title: spec.title, description: spec.description, board: spec.board, revisedAt },
  }
}

export function assertOpenRevisionReadback({ assignment, answerKey, preview, indexes, spec }) {
  const ids = spec.questions.map((question) => question.id)
  const sameIds = (questions) => JSON.stringify(questions?.map((question) => question.id)) === JSON.stringify(ids)
  const questions = spec.questions.map(({ answer: _answer, ...question }) => question)
  const entries = Object.fromEntries(spec.questions.map((question) => [question.id, publishedAnswer(question.answer)]))
  if (assignment?.status !== 'open' || Object.keys(assignment.answers ?? {}).length
    || !sameIds(assignment.questions) || !sameIds(preview?.questions)
    || !isDeepStrictEqual(assignment.questions, questions) || !isDeepStrictEqual(preview.questions, questions)
    || !isDeepStrictEqual(answerKey?.entries, entries)
    || indexes.some((index) => index?.title !== spec.title || index?.description !== spec.description
      || !isDeepStrictEqual(index.board, spec.board))) {
    throw new Error('Ревизия теста не совпала с ролевым readback.')
  }
  return { testId: assignment.testId, questionCount: ids.length, revised: true, verified: true }
}
