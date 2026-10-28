import { describe, expect, it } from 'vitest'
import { learningContext } from './learning-context.mjs'

describe('public learning context', () => {
  it('preserves legacy assignments and accepts all supported placements', () => {
    expect(learningContext(undefined)).toBeUndefined()
    for (const kind of ['homework', 'course', 'olympiad']) {
      expect(learningContext({ kind, id: 'formulo-2026_27' })).toEqual({ kind, id: 'formulo-2026_27' })
    }
  })
  it('rejects untrusted, ambiguous or private placement data', () => {
    for (const input of [null, [], {}, { kind: 'olympiad', id: '../bad' }, { kind: 'other', id: 'ok' }, { kind: 'olympiad', id: 'ok', answer: 'private' }]) {
      expect(() => learningContext(input)).toThrow()
    }
  })
})
