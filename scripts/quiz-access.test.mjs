import { describe, expect, it } from 'vitest'
import { assertQuizOwner } from './quiz-access.mjs'

const owner = { familyId: 'family-1', childId: 'child-1' }

describe('quiz access before a student link is issued', () => {
  it('accepts the exact family and child', () => {
    expect(() => assertQuizOwner({ ...owner, status: 'open' }, owner)).not.toThrow()
  })

  it('rejects the missing binding that blocked history and literature', () => {
    expect(() => assertQuizOwner({ status: 'open' }, owner)).toThrow('не сможет сохранить ответ')
  })

  it('rejects another family or child', () => {
    expect(() => assertQuizOwner({ ...owner, childId: 'child-2' }, owner)).toThrow()
    expect(() => assertQuizOwner({ ...owner, familyId: 'family-2' }, owner)).toThrow()
  })
})
