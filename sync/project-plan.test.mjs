import { describe, expect, it } from 'vitest'
import { dateWindow, mapBounded, projectTargets } from './project-plan.mjs'

describe('global project inventory', () => {
  const input = {
    families: [{ id: 'family-1' }, { id: 'family-2' }],
    children: [{ familyId: 'family-1', id: 'child-1' }, { familyId: 'family-1', id: 'child-2' }, { familyId: 'family-2', id: 'child-3' }],
    identities: [
      { familyId: 'family-1', childId: 'child-1', sourcePersonId: 'mesh-1' },
      { familyId: 'family-1', childId: 'child-2', sourcePersonId: 'mesh-2' },
      { familyId: 'family-2', childId: 'child-3', sourcePersonId: 'mesh-3' },
    ],
    accounts: [{ id: 'account-1', familyId: 'family-1', personId: 'adult-1', source: 'mesh' }],
    members: [{ familyId: 'family-1', id: 'adult-1', active: true, role: 'parent', childIds: ['child-1', 'child-2'] }],
    localAccounts: ['account-1'], legacy: null,
  }
  it('includes every child and chooses one shared parent account without merging children', () => {
    const targets = projectTargets(input)
    expect(targets.map((item) => item.state)).toEqual(['queued', 'queued', 'blocked'])
    expect(targets[0].sourceAccountId).toBe(targets[1].sourceAccountId)
    expect(targets[2].reason).toBe('source-account-required')
  })
  it('does not accept duplicate source identities', () => {
    expect(() => projectTargets({ ...input, identities: [...input.identities, input.identities[0]] })).toThrow(/несколько/)
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
})
