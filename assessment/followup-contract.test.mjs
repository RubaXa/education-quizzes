import { describe, expect, it } from 'vitest'
import { assertFollowupCoverage, assertOpenRevisionReadback, openQuizRevision } from './followup-contract.mjs'
import { followupQuestionCount } from '../src/lib/quizCompletion.ts'

const spec = { slug: 'same-link', subject: 'История', linkedToTestId: 'source', title: 'Новый раунд',
  description: 'Адресный повтор', board: { purpose: 'Проверка' }, questions: [
    { id: 'new-a', kind: 'short', answer: { correct: 'a', sourceEvidence: ['PRIVATE-LOCAL-SOURCE'] } },
    { id: 'new-b', kind: 'single', answer: { correct: 'b' } },
    { id: 'transfer', kind: 'single', answer: { correct: 'c' } },
  ] }
const plan = { items: [{ questionId: 'new-a', layer: 'current' }, { questionId: 'new-b', layer: 'prior-gap' },
  { questionId: 'transfer', layer: 'transfer' }],
followupCoverage: { sourceTestId: 'source', errors: [
  { sourceQuestionId: 'old-a', newQuestionIds: ['new-a'] },
  { sourceQuestionId: 'old-b', newQuestionIds: ['new-b'] },
] } }

describe('follow-up coverage and unopened revision', () => {
  it('requires nine distinct questions after five errors in five questions', () => {
    const sourceIds = Array.from({ length: 5 }, (_value, index) => `old-${index}`)
    const directIds = Array.from({ length: 5 }, (_value, index) => `direct-${index}`)
    const questions = [...directIds, 'reinforce-1', 'reinforce-2', 'spaced', 'transfer-new']
      .map((id) => ({ id }))
    const nine = { questions }
    const ninePlan = { items: questions.map(({ id }) => ({ questionId: id, layer: id === 'transfer-new' ? 'transfer' : 'prior-gap' })),
      followupCoverage: { sourceTestId: 'source', errors: sourceIds.map((sourceQuestionId, index) =>
        ({ sourceQuestionId, newQuestionIds: [directIds[index]] })) } }
    expect(followupQuestionCount(5, 5)).toBe(questions.length)
    expect(assertFollowupCoverage(ninePlan, nine, 'source', sourceIds)).toEqual({ coveredErrors: 5, distinctChecks: 5 })
    expect(() => assertFollowupCoverage(ninePlan, { questions: questions.slice(1) }, 'source', sourceIds)).toThrow('Одна новая проверка')
  })
  it('requires a distinct new check for every actual error', () => {
    expect(assertFollowupCoverage(plan, spec, 'source', ['old-a', 'old-b']).coveredErrors).toBe(2)
    expect(() => assertFollowupCoverage(plan, spec, 'source', ['old-a', 'old-b', 'old-c']))
      .toThrow('Не каждая ошибка')
    expect(() => assertFollowupCoverage({ ...plan, followupCoverage: { ...plan.followupCoverage,
      errors: [{ sourceQuestionId: 'old-a', newQuestionIds: ['new-a'] },
        { sourceQuestionId: 'old-b', newQuestionIds: ['new-a'] }] } }, spec, 'source', ['old-a', 'old-b']))
      .toThrow('Одна новая проверка')
  })

  it('keeps the same owner and link, and refuses saved answers', () => {
    const current = { testId: 'active', status: 'open', answers: {}, startedAt: null, updatedAt: null,
      submittedAt: null, familyId: 'family', childId: 'child', linkedToTestId: 'source',
      slug: 'same-link', subject: 'История' }
    const patch = openQuizRevision({ current, spec, owner: { familyId: 'family', childId: 'child' }, revisedAt: 'now' })
    expect(patch.assignment.questions).toHaveLength(3)
    expect(patch.assignment.questions[0]).not.toHaveProperty('answer')
    expect(JSON.stringify(patch)).not.toContain('PRIVATE-LOCAL-SOURCE')
    expect(patch.answerKey.entries['new-a']).not.toHaveProperty('sourceEvidence')
    expect(assertOpenRevisionReadback({ assignment: { ...current, ...patch.assignment }, answerKey: patch.answerKey,
      preview: patch.preview, indexes: [patch.index], spec }).verified).toBe(true)
    expect(() => assertOpenRevisionReadback({ assignment: { ...current, ...patch.assignment },
      answerKey: { entries: { ...patch.answerKey.entries, 'new-a': { correct: 'wrong-key' } } },
      preview: patch.preview, indexes: [patch.index], spec })).toThrow('readback')
    expect(() => openQuizRevision({ current: { ...current, answers: { old: 'answer' } }, spec,
      owner: { familyId: 'family', childId: 'child' }, revisedAt: 'now' })).toThrow('без сохранённых ответов')
  })
})
