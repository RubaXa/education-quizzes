import { describe, expect, it } from 'vitest'
import { quizLineageStatistics } from './quiz-lineage.mjs'

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
    expect(result.next).toEqual({ sourceTestId: 'second', errorQuestionIds: ['a', 'b'], targetCount: 5 })
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
