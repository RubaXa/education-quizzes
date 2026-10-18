/** @see ../docs/modules/families/access-and-state.md#authenticated-learning-routes */
import { describe, expect, it } from 'vitest'
import { assertLearningRouteIdentity, learningDayAliases, learningRouteIdentity } from './learning-route-identity.mjs'
describe('published learning resource aliases', () => {
  it('binds both role projections to a single canonical resource without private guides', () => {
    expect(learningRouteIdentity({ student: 'shared', parent: 'internal-parent' }, { familyId: 'family', childId: 'child' })).toEqual({
      familyId: 'family', childId: 'child', canonicalToken: 'shared', viewTokens: { student: 'shared', parent: 'internal-parent' },
    })
  })
  it('rejects an incomplete, identical or ownerless pair', () => {
    expect(() => learningRouteIdentity({ student: 'shared' }, {})).toThrow()
    expect(() => learningRouteIdentity({ student: 'same', parent: 'same' }, { familyId: 'f', childId: 'c' })).toThrow()
  })
  it('maps both historical view tokens to the same canonical day and checks readback', () => {
    expect(learningDayAliases({ old: { student: 'student-old', parent: 'parent-old' }, next: { student: 'student-new', parent: 'parent-new' } })).toEqual({
      'student-old': 'student-old', 'parent-old': 'student-old', 'student-new': 'student-new', 'parent-new': 'student-new',
    })
    const expected = learningRouteIdentity({ student: 's', parent: 'p' }, { familyId: 'f', childId: 'c' })
    expect(() => assertLearningRouteIdentity(expected, expected)).not.toThrow()
    expect(() => assertLearningRouteIdentity({ ...expected, childId: 'other' }, expected)).toThrow(/проверка/)
  })
})
