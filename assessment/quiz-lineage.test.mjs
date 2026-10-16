import { describe, expect, it } from 'vitest'
import { assertLineageContinuation, followupQueueSource, quizLineageStatistics } from './quiz-lineage.mjs'

const attempt = (testId, answers, linkedToTestId = null) => ({
  assignment: { schemaVersion: 1, testId, linkedToTestId, status: 'submitted', answers,
    questions: [
      { id: 'a', topic: 'Тема А', kind: 'single', points: 1 },
      { id: 'b', topic: 'Тема Б', kind: 'single', points: 1 },
    ] },
  answerKey: { entries: { a: { correct: 'right' }, b: { correct: 'right' } } },
  review: null,
})

describe('linked quiz history', () => {
  it('counts answer choices and correctness across the chain without exposing short-answer text', () => {
    const result = quizLineageStatistics([
      attempt('second', { a: 'wrong', b: 'wrong' }, 'first'),
      attempt('first', { a: 'wrong', b: 'right' }),
    ])
    expect(result.next).toMatchObject({ sourceTestId: 'second', errorQuestionIds: ['a', 'b'], targetCount: 5 })
    expect(result.topics).toEqual([
      { topic: 'Тема А', correct: 0, partial: 0, incorrect: 2, skipped: 0 },
      { topic: 'Тема Б', correct: 1, partial: 0, incorrect: 1, skipped: 0 },
    ])
    expect(result.attempts[0].items[0].selectedOptionIds).toBe('wrong')
  })

  it('refuses an open attempt or a manual answer without review', () => {
    const open = attempt('open', { a: 'right', b: 'right' })
    open.assignment.status = 'open'
    expect(() => quizLineageStatistics([open])).toThrow('непроверенную попытку')
  })
})

/** @see ../docs/modules/assessments/assessment-decision-graph.md#followup-threshold */
describe('one continuation policy for parent requests and automatic generation', () => {
  const full = (testId, count, correct, linkedToTestId = null) => {
    const questions = Array.from({ length: count }, (_, i) => ({ id: `q${i}`, topic: `Навык ${i}`, kind: 'single', points: 1 }))
    return { assignment: { testId, linkedToTestId, status: 'submitted', questions,
      answers: Object.fromEntries(questions.map((q, i) => [q.id, i < correct ? 'right' : 'wrong'])) },
    answerKey: { entries: Object.fromEntries(questions.map(q => [q.id, { correct: 'right' }])) }, review: null }
  }
  const chain = () => [full('last', 5, 5, 'repair'), full('repair', 7, 0, 'root'), full('root', 11, 6)]
  const publication = (attempts, coverageCount = 2) => {
    const next = quizLineageStatistics(attempts, coverageCount).next
    const sources = [{ id: 'book', role: 'family-material', verified: true }]
    const objectives = Array.from({ length: coverageCount }, (_, i) => ({ id: `goal${i}` }))
    const questions = next.slots.map((slot, i) => ({ id: `new${i}`, kind: 'single' }))
    const items = next.slots.map((slot, i) => ({ questionId: questions[i].id,
      layer: slot.role === 'historical-error' ? 'prior-gap' : ['spaced', 'transfer'].includes(slot.role) ? slot.role : 'current',
      objectiveId: objectives[i % coverageCount].id, sourceIds: ['book'] }))
    const plan = { sources, objectives, items, followupCoverage: { sourceTestId: next.sourceTestId, errors: next.slots.filter(slot => slot.role === 'current-error').map(slot => ({ sourceQuestionId: slot.sourceQuestionId, newQuestionIds: [questions[next.slots.indexOf(slot)].id] })) }, continuation: { ...next,
      topicCoverage: objectives.map(objective => ({ objectiveId: objective.id, sourceId: 'book' })),
      checks: next.slots.map((slot, i) => ({ slotId: slot.slotId, questionId: questions[i].id,
        ...(slot.sourceTestId ? { sourceTestId: slot.sourceTestId, sourceQuestionId: slot.sourceQuestionId } : {}) })) } }
    return { plan, spec: { questions }, next }
  }
  it('queues a fully checked 100% only on parent request; pending work is never a failure', () => {
    const perfect = full('perfect', 5, 5)
    expect(followupQueueSource(perfect.assignment, perfect.answerKey)).toBeNull()
    perfect.assignment.followupRequestedAt = true
    expect(followupQueueSource(perfect.assignment, perfect.answerKey)).toMatchObject({ errorCount: 0, targetCount: null, historyRequired: true, trigger: 'parent-request' })
    const failed = full('failed', 7, 0)
    expect(followupQueueSource(failed.assignment, failed.answerKey)).toMatchObject({ errorCount: 7, trigger: 'below-threshold' })
    failed.assignment.questions[0].kind = 'long'
    expect(followupQueueSource(failed.assignment, failed.answerKey)).toBeNull()
    expect(followupQueueSource({ ...perfect.assignment, status: 'open' }, perfect.answerKey)).toBeNull()
  })
  it('uses the original topic scope and all historical weaknesses after a short 100% round', () => {
    const next = quizLineageStatistics(chain()).next
    expect(next.strategy).toBe('consolidation')
    expect(next.targetCount).toBe(16) // root 11 + three historical gaps + spaced + transfer
    expect(next.slots.filter(s => s.role === 'topic-coverage')).toHaveLength(11)
    expect(next.slots.filter(s => s.role === 'historical-error').map(s => s.topic)).toEqual(['Навык 6', 'Навык 0', 'Навык 1'])
    expect(quizLineageStatistics(chain()).next).toEqual(next)
    expect(quizLineageStatistics([full('only', 7, 7)]).next.targetCount).toBe(9)
  })
  it('never shrinks after a full failure and uses older errors during ordinary repair too', () => {
    const attempts = [full('next', 7, 0, 'first'), full('first', 11, 3)]
    const next = quizLineageStatistics(attempts).next
    expect(next.targetCount).toBe(12)
    expect(next.slots.filter(s => s.role === 'current-error')).toHaveLength(7)
    expect(next.slots.find(s => s.role === 'historical-error')?.topic).toBe('Навык 3')
    const repaired = publication(attempts)
    expect(assertLineageContinuation(repaired.plan, repaired.spec, attempts).strategy).toBe('repair')
  })
  it('validates every planned slot and rejects missing history, stale plans and dropped coverage', () => {
    const attempts = chain(), { plan, spec, next } = publication(attempts)
    expect(assertLineageContinuation(plan, spec, attempts)).toEqual(next)
    expect(() => quizLineageStatistics(attempts.slice(0, 1))).toThrow('всю причинную цепочку')
    const changed = chain(); changed[2].assignment.answers.q6 = 'right'
    expect(() => assertLineageContinuation(plan, spec, changed)).toThrow('полной проверенной истории')
    expect(() => assertLineageContinuation(plan, { questions: spec.questions.slice(1) }, attempts)).toThrow('16 вопросов')
    const missing = structuredClone(plan); missing.continuation.checks.pop()
    expect(() => assertLineageContinuation(missing, spec, attempts)).toThrow('отдельный новый вопрос')
    const wrong = structuredClone(plan); wrong.continuation.checks[0].sourceQuestionId = 'not-in-root'
    expect(() => assertLineageContinuation(wrong, spec, attempts)).toThrow('покрытие')
    const bare = structuredClone(plan); bare.continuation.topicCoverage = []
    expect(() => assertLineageContinuation(bare, spec, attempts)).toThrow('матрицу всей темы')
    const broad = publication(attempts, 13)
    expect(broad.next.targetCount).toBe(18)
    expect(assertLineageContinuation(broad.plan, broad.spec, attempts).targetCount).toBe(18)
    const extra = structuredClone(plan); extra.continuation.topicCoverage[0].sourceId = 'not-family-book'
    expect(() => assertLineageContinuation(extra, spec, attempts)).toThrow('семейных источников')
  })
})
