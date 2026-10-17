import { describe, expect, it } from 'vitest'
import { collectedProjectSummary, dateWindow, mapBounded, projectTargets } from './project-plan.mjs'
import { meshChildIdentityId, meshParentAccountId } from '../packages/education-runtime/identity.mjs'

describe('global project inventory', () => {
  const input = {
    families: [{ id: 'family-1' }, { id: 'family-2' }],
    children: [{ familyId: 'family-1', id: 'child-1', meshPersonId: 'mesh-1' }, { familyId: 'family-1', id: 'child-2', meshPersonId: 'mesh-2' }, { familyId: 'family-2', id: 'child-3', meshPersonId: 'mesh-3' }],
    identities: [
      { id: meshChildIdentityId('mesh-1'), source: 'mesh', familyId: 'family-1', childId: 'child-1', sourcePersonId: 'mesh-1' },
      { id: meshChildIdentityId('mesh-2'), source: 'mesh', familyId: 'family-1', childId: 'child-2', sourcePersonId: 'mesh-2' },
      { id: meshChildIdentityId('mesh-3'), source: 'mesh', familyId: 'family-2', childId: 'child-3', sourcePersonId: 'mesh-3' },
    ],
    accounts: [{ id: meshParentAccountId('adult-mesh-1'), familyId: 'family-1', personId: 'adult-1', source: 'mesh', sourcePersonId: 'adult-mesh-1' }],
    members: [{ familyId: 'family-1', id: 'adult-1', active: true, role: 'parent', childIds: ['child-1', 'child-2'] }],
    localAccounts: [meshParentAccountId('adult-mesh-1')], legacy: null,
  }
  it('includes every registered child and chooses one shared parent account without merging children', () => {
    const targets = projectTargets(input)
    expect(targets.map((item) => item.state)).toEqual(['queued', 'queued', 'blocked'])
    expect(targets[0].sourceAccountId).toBe(targets[1].sourceAccountId)
    expect(targets[2].reason).toBe('source-account-required')
  })
  it('does not accept duplicate source identities', () => {
    expect(() => projectTargets({ ...input, identities: [...input.identities, input.identities[0]] })).toThrow(/несколько/)
  })
  it('excludes inactive graph nodes and identity/account bindings that do not match the exact child', () => {
    const changed = { ...input,
      families: [...input.families, { id: 'family-off', active: false }],
      children: [...input.children, { familyId: 'family-1', id: 'child-off', meshPersonId: 'mesh-off', active: false },
        { familyId: 'family-off', id: 'child-off-family', meshPersonId: 'mesh-family-off' }],
      identities: input.identities.map((identity) => identity.childId === 'child-1'
        ? { ...identity, sourcePersonId: 'other-person' } : identity),
    }
    expect(projectTargets(changed).map((item) => `${item.familyId}/${item.childId}`)).toEqual([
      'family-1/child-1', 'family-1/child-2', 'family-2/child-3',
    ])
  })
  it('rechecks Monday through six full weeks even when started midweek', () => {
    for (const today of ['2026-10-12', '2026-10-15', '2026-10-18']) {
      const dates = dateWindow(today)
      expect(dates).toHaveLength(42)
      expect(dates[0]).toBe('2026-10-12')
      expect(dates.at(-1)).toBe('2026-11-22')
    }
  })
  it('bounds parallel workers and retains every result', async () => {
    let active = 0, highest = 0
    const result = await mapBounded([1, 2, 3, 4], 2, async (value) => {
      highest = Math.max(highest, ++active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      if (value === 3) throw new Error('stopped')
      return value
    })
    expect(highest).toBeLessThanOrEqual(2)
    expect(result.map((item) => item.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled'])
  })
  it('aggregates all families once and does not call a source diff a publication', () => {
    const summary = collectedProjectSummary({
      inventory: { families: 2, children: 3, sourceAccounts: 2 },
      jobs: [
        { familyId: 'one', childId: 'a', checkedDates: 42, changes: { lessons: 2, assignments: 1, grades: 1 }, pendingPublicationDates: [{ date: '2026-10-15' }], state: 'awaiting-enrichment' },
        { familyId: 'one', childId: 'b', checkedDates: 42, changes: { lessons: 0, assignments: 1, grades: 0 }, pendingPublicationDates: [], state: 'complete' },
        { familyId: 'two', childId: 'c', state: 'blocked', reason: 'auth-required' },
      ],
    })
    expect(summary).toEqual({
      familiesDiscovered: 2, childrenDiscovered: 3, sourceAccountsDiscovered: 2,
      familiesSourceChecked: 1, childrenSourceChecked: 2,
      familiesWithSourceChanges: 1, childrenWithSourceChanges: 2,
      sourceChanges: { lessons: 2, assignments: 2, grades: 1 },
      checkedDates: 84, pendingPublicationDays: 1, blockedChildren: 1,
    })
    expect(summary).not.toHaveProperty('published')
  })
  it('does not call a family checked when one of its children was blocked', () => {
    const summary = collectedProjectSummary({ inventory: { families: 1, children: 2, sourceAccounts: 1 }, jobs: [
      { familyId: 'one', childId: 'a', checkedDates: 42, changes: {} },
      { familyId: 'one', childId: 'b', state: 'blocked', reason: 'auth-required' },
    ] })
    expect(summary.familiesSourceChecked).toBe(0)
    expect(summary.childrenSourceChecked).toBe(1)
    expect(summary.blockedChildren).toBe(1)
  })
})
