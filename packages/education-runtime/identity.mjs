/** @see ../../docs/modules/families/early-development.md */
/** Shared ownership predicates for sync, Telegram, and operations.
 * @see ../../docs/shared/server-runtime.md#авторизация-и-совместимость
 */
import { createHash } from 'node:crypto'

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

export function validRuntimeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value)
}

export function meshParentAccountId(actorId) {
  if (!validRuntimeId(actorId)) return null
  return createHash('sha256').update(`mesh-parent:${actorId}`).digest('hex')
}

export function meshChildIdentityId(personId) {
  if (!validRuntimeId(personId)) return null
  return createHash('sha256').update(`mesh-child:${personId}`).digest('hex')
}

export function isActiveParentForChild(member, childId) {
  return member?.active === true && member.role === 'parent'
    && Array.isArray(member.childIds) && member.childIds.includes(childId)
}

export function isActiveFamilyChild({ familyId, childId, family, child }) {
  return validRuntimeId(familyId) && validRuntimeId(childId)
    && family?.active !== false && child?.active !== false
}

export function isRegisteredMeshParentAccount({ familyId, family, account, member }) {
  return validRuntimeId(familyId) && family?.active !== false
    && account?.source === 'mesh' && account.familyId === familyId && !account.disconnectedAt
    && validRuntimeId(account.personId) && validRuntimeId(account.sourcePersonId)
    && meshParentAccountId(account.sourcePersonId) === account.id
    && member?.id === account.personId && member.active === true && member.role === 'parent'
}

export function isRegisteredMeshChild({ familyId, childId, family, child, identity }) {
  return isActiveFamilyChild({ familyId, childId, family, child })
    && child?.learningMode !== 'early-development'
    && validRuntimeId(child?.meshPersonId)
    && identity?.id === meshChildIdentityId(child.meshPersonId)
    && identity?.source === 'mesh' && identity.familyId === familyId
    && identity.childId === childId && identity.sourcePersonId === child.meshPersonId
}

export function isOwnedMeshAccount({ familyId, childId, sourcePersonId, sourceAccountId,
  family, child, identity, account, member }) {
  return isRegisteredMeshChild({ familyId, childId, family, child, identity })
    && validRuntimeId(sourcePersonId) && validRuntimeId(sourceAccountId)
    && sourcePersonId === child.meshPersonId
    && account?.id === sourceAccountId
    && isRegisteredMeshParentAccount({ familyId, family, account, member })
    && isActiveParentForChild(member, childId)
}

export function eligibleMeshAccounts({ familyId, childId, family, child, members, identities, accounts }) {
  const identity = (identities ?? []).find((item) => item.familyId === familyId && item.childId === childId)
  if (!isRegisteredMeshChild({ familyId, childId, family, child, identity })) return []
  const byPerson = new Map((members ?? []).map((member) => [member.id, member]))
  return (accounts ?? []).filter((account) => isOwnedMeshAccount({ familyId, childId,
    sourcePersonId: child.meshPersonId, sourceAccountId: account.id, family, child, identity,
    account, member: byPerson.get(account.personId) }))
    .sort((left, right) => left.id.localeCompare(right.id))
}
