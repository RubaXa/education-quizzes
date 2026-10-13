import { describe, expect, it } from 'vitest'
import { findQuizPlacement, type QuizCardAttempt } from './quizCardViewModel'

const quiz = (token: string, testId: string, linkedToTestId?: string): QuizCardAttempt => ({
  token, testId, linkedToTestId, title: token, slug: token, status: 'open', answered: 0, total: 1,
})

/** @see ../../docs/product/dashboard.md#schedule-homework-status */
describe('destination of a linked self-check', () => {
  const tests = [quiz('first', 'test-1'), quiz('retry', 'test-2', 'test-1')]
  it('locates the original assignment card for a follow-up test', () => {
    expect(findQuizPlacement([{ token: 'first', taskId: 'english-work' }], tests, 'retry'))
      .toEqual({ token: 'first', taskId: 'english-work' })
  })
  it('does not send an unrelated test to this assignment', () => {
    expect(findQuizPlacement([{ token: 'first', taskId: 'english-work' }], tests, 'other')).toBeUndefined()
  })
})
