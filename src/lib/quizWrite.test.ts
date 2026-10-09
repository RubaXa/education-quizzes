import { describe, expect, it } from 'vitest'
import { assertOpenAssignment } from './quizWrite'

describe('quiz answer write', () => {
  it('accepts an open assignment', () => {
    expect(() => assertOpenAssignment({ status: 'open' })).not.toThrow()
  })

  it('does not report a missing assignment as saved', () => {
    expect(() => assertOpenAssignment(undefined)).toThrow('не сохранён')
  })

  it('does not report a closed assignment as saved', () => {
    expect(() => assertOpenAssignment({ status: 'submitted' })).toThrow('не сохранён')
  })
})
