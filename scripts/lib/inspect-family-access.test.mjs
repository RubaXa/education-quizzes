// @see ../../docs/modules/families/access-and-state.md#access-diagnostics
import { describe, expect, it } from 'vitest'
import { inspectFamilyAccess } from './inspect-family-access.mjs'

function fixture() {
  const registry = { people: { adult: { familyId: 'family', role: 'parent' } }, families: { family: { childIds: ['child'] } }, links: { adult: ['secret-adult'] } }
  const data = new Map([
    ['users/adult', {}], ['users/adult/families/family', {}],
    ['families/family/members/adult', { active: true, role: 'parent', childIds: ['child'] }],
    ['families/family/children/child', {}],
    ['users/adult/families/family/shortcuts/child', { dashboardToken: 'pd', dashboardTokens: { parent: 'pd', student: 'sd' }, dayToken: 'pp', dayTokens: { parent: 'pp', student: 'sp' } }],
    ['accessLinks/secret-adult', { active: true, personId: 'adult' }],
  ])
  for (const [token, role] of [['pd', 'parent'], ['sd', 'student']]) data.set(`dayDashboards/${token}`, { familyId: 'family', childId: 'child', kind: role, weekendWork: [{ dayToken: role === 'parent' ? 'pp' : 'sp', taskIds: ['task'] }] })
  for (const [token, role] of [['pp', 'parent'], ['sp', 'student']]) data.set(`dayPages/${token}`, { familyId: 'family', childId: 'child', kind: role, subjects: [{ tasks: [{ id: 'task' }] }] })
  const reads = []
  const db = { doc: (path) => ({ get: async () => { reads.push(path); return { exists: data.has(path), data: () => data.get(path) } } }) }
  return { registry, data, db, reads }
}

describe('scoped family role diagnostics', () => {
  it('traces both projections and weekend sources without repeating reads or printing tokens', async () => {
    const f = fixture(); const result = await inspectFamilyAccess(f.db, f.registry, 'adult')
    expect(result.issues).toEqual([])
    expect(result.serverRole).toBe('parent')
    expect(result.documentsRead).toBe(10)
    expect(new Set(f.reads).size).toBe(f.reads.length)
    expect(JSON.stringify(result)).not.toContain('secret-adult')
  })
  it('detects a parent weekend pointing to the student projection', async () => {
    const f = fixture(); f.data.get('dayDashboards/pd').weekendWork[0].dayToken = 'sp'
    expect((await inspectFamilyAccess(f.db, f.registry, 'adult')).issues).toContain('weekend-parent-identity-mismatch')
  })
  it('detects duplicated role aliases and a wrong primary shortcut', async () => {
    const f = fixture(); const shortcut = f.data.get('users/adult/families/family/shortcuts/child')
    shortcut.dashboardTokens.parent = 'sd'
    const result = await inspectFamilyAccess(f.db, f.registry, 'adult')
    expect(result.issues).toContain('dayDashboards-role-token-collision')
    expect(result.issues).toContain('dayDashboards-primary-role-mismatch')
    expect(result.issues).toContain('dayDashboards-parent-identity-mismatch')
  })
  it('does not follow a child outside the registered family scope', async () => {
    const f = fixture(); f.data.get('families/family/members/adult').childIds.push('foreign')
    const result = await inspectFamilyAccess(f.db, f.registry, 'adult')
    expect(result.issues).toContain('membership-child-outside-family')
    expect(f.reads.some((path) => path.includes('foreign'))).toBe(false)
  })
})
