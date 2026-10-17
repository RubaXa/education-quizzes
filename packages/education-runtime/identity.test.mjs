import { describe, expect, it } from 'vitest'
import { eligibleMeshAccounts, isActiveFamilyChild, isActiveParentForChild, isOwnedMeshAccount,
  isRegisteredMeshParentAccount, meshChildIdentityId, meshParentAccountId } from './identity.mjs'

describe('shared Mesh identity and ownership predicates', () => {
  const familyId = 'family-a', childId = 'child-a', sourcePersonId = 'mesh-child-a', actorId = 'mesh-parent-a'
  const family = { active: true }
  const child = { active: true, meshPersonId: sourcePersonId }
  const identity = { id: meshChildIdentityId(sourcePersonId), source: 'mesh', familyId, childId, sourcePersonId }
  const account = { id: meshParentAccountId(actorId), source: 'mesh', familyId, personId: 'parent-a', sourcePersonId: actorId }
  const member = { id: 'parent-a', active: true, role: 'parent', childIds: [childId] }
  const descriptor = { familyId, childId, sourcePersonId, sourceAccountId: account.id, family, child, identity, account, member }

  it('accepts only the exact active registry and parent/account binding', () => {
    expect(isOwnedMeshAccount(descriptor)).toBe(true)
    expect(isOwnedMeshAccount({ ...descriptor, identity: { ...identity, childId: 'other' } })).toBe(false)
    expect(isOwnedMeshAccount({ ...descriptor, account: { ...account, disconnectedAt: 'revoked' } })).toBe(false)
    expect(isOwnedMeshAccount({ ...descriptor, member: { ...member, childIds: [] } })).toBe(false)
  })

  it('selects account candidates deterministically and excludes mismatched child ownership', () => {
    const result = eligibleMeshAccounts({ familyId, childId, family, child, identities: [identity], members: [member],
      accounts: [account, { ...account, id: 'bad-account', sourcePersonId: 'different' }] })
    expect(result).toEqual([account])
  })

  it('shares exact active family, child, and parent-account contracts across consumers', () => {
    expect(isActiveFamilyChild({ familyId, childId, family, child })).toBe(true)
    expect(isActiveFamilyChild({ familyId, childId, family: { active: false }, child })).toBe(false)
    expect(isActiveFamilyChild({ familyId, childId, family, child: { ...child, active: false } })).toBe(false)
    expect(isActiveParentForChild(member, childId)).toBe(true)
    expect(isActiveParentForChild({ ...member, active: false }, childId)).toBe(false)
    expect(isRegisteredMeshParentAccount({ familyId, family, account, member })).toBe(true)
    expect(isRegisteredMeshParentAccount({ familyId, family, account, member: { ...member, id: 'other-parent' } })).toBe(false)
    expect(isRegisteredMeshParentAccount({ familyId, family, account: { ...account, disconnectedAt: 'revoked' }, member })).toBe(false)
    expect(isRegisteredMeshParentAccount({ familyId, family, account: { ...account, id: 'forged' }, member })).toBe(false)
  })
})
