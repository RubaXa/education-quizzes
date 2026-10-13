import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCachedQuiz, readQuizDraft, writeCachedQuiz, writeQuizDraft } from './quizDraft'
import type { Assignment } from './quiz'

const items = new Map<string, string>()

beforeEach(() => {
  items.clear()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value) },
      removeItem: (key: string) => { items.delete(key) },
    },
  } })
})

afterEach(() => { Reflect.deleteProperty(globalThis, 'window') })

describe('quiz recovery copy', () => {
  it('keeps unsent answers for one test and clears them after confirmation', () => {
    expect(writeQuizDraft('first', { q1: 'long answer', q2: ['a', 'b'] })).toBe(true)
    expect(readQuizDraft('first')).toEqual({ q1: 'long answer', q2: ['a', 'b'] })
    expect(readQuizDraft('other')).toEqual({})
    expect(writeQuizDraft('first', {})).toBe(true)
    expect(readQuizDraft('first')).toEqual({})
  })

  it('ignores malformed stored answers', () => {
    items.set('education.quiz-draft.v1.first', JSON.stringify({ q1: 'safe', q2: 42, q3: ['a', 3] }))
    expect(readQuizDraft('first')).toEqual({ q1: 'safe' })
  })

  it('restores a cached question sheet while the server is unavailable', () => {
    const assignment = { schemaVersion: 1, title: 'Test', subject: 'Russian', questions: [], answers: {}, status: 'open' } as unknown as Assignment
    writeCachedQuiz('first', assignment)
    expect(readCachedQuiz('first')?.title).toBe('Test')
    expect(readCachedQuiz('other')).toBeNull()
  })

  it('reports storage refusal instead of claiming a backup exists', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    } } })
    expect(writeQuizDraft('first', { q1: 'answer' })).toBe(false)
    expect(readQuizDraft('first')).toEqual({})
  })
})
