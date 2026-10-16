import { describe, expect, it } from 'vitest'
import { findQuizPlacement, quizRoot, quizTaskForPlacement, withQuizPlacements, type QuizCardAttempt } from './quizCardViewModel'
import type { DayTask, DayTestPlacement } from './dayStore'

const quiz = (token: string, testId: string, linkedToTestId?: string): QuizCardAttempt => ({
  token, testId, linkedToTestId, title: token, slug: token, status: 'open', answered: 0, total: 1,
})

describe('legacy single check assignment', () => {
  const task = { id: 'mesh-351501906', kind: 'check' } as DayTask
  const placement = { token: 'english-quiz' } as DayTestPlacement
  it('links the sole self-check instead of counting the same work twice', () => {
    expect(quizTaskForPlacement([task], [placement], placement)).toBe(task)
    expect(withQuizPlacements([task], [placement])[0].testToken).toBe('english-quiz')
  })
  it('does not attach a test from another subject or an ambiguous set', () => {
    expect(quizTaskForPlacement([task], [placement], { token: 'math-quiz' } as DayTestPlacement)).toBeUndefined()
    expect(quizTaskForPlacement([task], [placement, { token: 'another' } as DayTestPlacement], placement)).toBeUndefined()
  })
})

/** @see ../../docs/modules/school-diary/dashboard.md#schedule-homework-status */
describe('destination of a linked self-check', () => {
  const tests = [quiz('first', 'test-1'), quiz('retry', 'test-2', 'test-1')]
  it('locates the original assignment card for a follow-up test', () => {
    expect(findQuizPlacement([{ token: 'first', taskId: 'english-work' }], tests, 'retry'))
      .toEqual({ token: 'first', taskId: 'english-work' })
  })
  it('does not send an unrelated test to this assignment', () => {
    expect(findQuizPlacement([{ token: 'first', taskId: 'english-work' }], tests, 'other')).toBeUndefined()
  })
  it('takes the optional decision from the first attempt even on a later board card', () => {
    const chain = [quiz('first', 'test-1'), quiz('retry', 'test-2', 'test-1'), quiz('again', 'test-3', 'test-2')]
    expect(quizRoot(chain[2], chain).token).toBe('first')
    expect(quizRoot(chain[1], chain).token).toBe('first')
  })
})
