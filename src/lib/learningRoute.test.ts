/** @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes */
import { describe, expect, it, vi } from 'vitest'
vi.mock('./firebase', () => ({ db: {} }))
import { dashboardTarget, dayTarget, learningHash } from './learningRoute'
import type { PersonalProfile } from './personalAccess'

const profile = (role: 'parent' | 'student'): PersonalProfile => ({ personId: 'person', displayName: 'Person', children: [{
  familyId: 'family', childId: 'child', displayName: 'Ребёнок', role, dashboardToken: role === 'parent' ? 'parent-dashboard' : 'shared-dashboard',
  dashboardTokens: { student: 'shared-dashboard', parent: 'parent-dashboard' },
}] })
describe('one learning address, authenticated membership', () => {
  it.each(['parent', 'student'] as const)('resolves the same dashboard address from %s membership', (role) => {
    const result = dashboardTarget(profile(role), 'shared-dashboard')!
    expect(result.parent).toBe(role === 'parent')
    expect(result.token).toBe(role === 'parent' ? 'parent-dashboard' : 'shared-dashboard')
    expect(learningHash('days', result.canonicalToken)).toBe('#/days/shared-dashboard')
    expect(dashboardTarget(profile(role), 'parent-dashboard')).toEqual(result)
  })
  it.each(['parent', 'student'] as const)('resolves the same historic day for %s without using its document role', (role) => {
    const result = dayTarget(profile(role), { familyId: 'family', childId: 'child', viewTokens: { student: 'shared-day', parent: 'parent-day' } })
    expect(result.parent).toBe(role === 'parent')
    expect(result.token).toBe(role === 'parent' ? 'parent-day' : 'shared-day')
    expect(learningHash('day', result.canonicalToken)).toBe('#/day/shared-day')
  })
  it('rejects other children, missing binding and ambiguous membership', () => {
    expect(dashboardTarget(profile('parent'), 'foreign')).toBeNull()
    expect(() => dayTarget(profile('parent'), { familyId: 'other', childId: 'child', viewTokens: { student: 'shared', parent: 'private' } })).toThrow(/недоступен/)
    expect(() => dayTarget(profile('parent'), { familyId: 'family', childId: 'child' })).toThrow(/не обновлена/)
    const ambiguous = profile('parent'); ambiguous.children.push(ambiguous.children[0])
    expect(dashboardTarget(ambiguous, 'shared-dashboard')).toBeNull()
  })
  it('does not choose the first student role from another family', () => {
    const combined = profile('parent')
    combined.children.unshift({ familyId: 'other', childId: 'other', displayName: 'Other', role: 'student', dashboardToken: 'other' })
    expect(dashboardTarget(combined, 'shared-dashboard')?.parent).toBe(true)
  })
})
