import { describe, expect, it } from 'vitest'
import { followupQuestionCount, needsQuizFollowup, quizPassed } from './quizCompletion'

describe('quiz completion and follow-up size', () => {
  it('passes exactly at 85% for every subject and rejects an unknown score', () => {
    expect(quizPassed({ points: 34, maxPoints: 40 })).toBe(true)
    expect(quizPassed({ points: 34, maxPoints: 39 })).toBe(true)
    expect(quizPassed({ points: 33, maxPoints: 40 })).toBe(false)
    expect(quizPassed(undefined)).toBe(false)
  })

  it('does not schedule a passing test unless the parent explicitly requests practice', () => {
    expect(needsQuizFollowup({ points: 34, maxPoints: 39 })).toBe(false)
    expect(needsQuizFollowup({ points: 34, maxPoints: 39 }, true)).toBe(true)
    expect(needsQuizFollowup({ points: 33, maxPoints: 40 })).toBe(true)
  })

  it('keeps five errors from a 39-question test to ten mixed questions', () => {
    expect(followupQuestionCount(39, 5)).toBe(10)
    expect(followupQuestionCount(39, 20)).toBe(29)
    expect(followupQuestionCount(39, 39)).toBe(39)
    expect(followupQuestionCount(39, 0)).toBe(0)
    expect(followupQuestionCount(20, 1)).toBe(4)
  })
})
