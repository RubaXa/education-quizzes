/** @see ../../../docs/services/telegram-bot/operations.md */
import { createHash } from 'node:crypto'
import { isActiveFamilyChild, isActiveParentForChild, isOwnedMeshAccount,
  meshChildIdentityId } from '../../education-runtime/identity.mjs'

/** Resolve an operator-selected opaque link digest to one currently authorized child. */
export async function resolveProbeTarget(db, digest) {
  if (!/^[a-f0-9]{16}$/.test(digest ?? '')) return null
  const snapshot = await db.collection('telegramBotFamilyLinks').where('status', '==', 'active').get()
  const matches = (snapshot.docs ?? []).filter((doc) => hash(doc.id) === digest)
  if (matches.length !== 1) return null
  const document = matches[0], link = document.data()
  if (!safeId(link?.familyId) || !safeId(link?.personId) || !validTelegramId(link?.telegramUserId)) return null
  const [familySnap, memberSnap, accountSnap] = await Promise.all([
    db.doc(`families/${link.familyId}`).get(),
    db.doc(`families/${link.familyId}/members/${link.personId}`).get(),
    db.doc(`telegramBotAccounts/${link.telegramUserId}`).get(),
  ])
  const family = familySnap.data(), memberData = memberSnap.data(), account = accountSnap.data()
  const member = { ...memberData, id: link.personId }
  if (!familySnap.exists || !memberSnap.exists || !accountSnap.exists) return null
  if (account?.status === 'disconnected' || (account?.channelStatus ?? 'available') !== 'available') return null
  const childIds = [...new Set((member.childIds ?? []).filter(safeId))].sort()
  for (const childId of childIds) {
    if (!isActiveParentForChild(member, childId)) continue
    const child = await db.doc(`families/${link.familyId}/children/${childId}`).get()
    if (child.exists && isActiveFamilyChild({ familyId: link.familyId, childId, family, child: child.data() })) return Object.freeze({ linkId: document.id,
      familyId: link.familyId, personId: link.personId, telegramUserId: String(link.telegramUserId), childId })
  }
  return null
}

/** Build a live read scope only from the active owner, child, identity, and account registry. */
export async function resolveMeshProbeScope(db, target, date) {
  if (!target || !validDay(date)) return null
  const [familySnap, childSnap, memberSnap, accountQuery] = await Promise.all([
    db.doc(`families/${target.familyId}`).get(),
    db.doc(`families/${target.familyId}/children/${target.childId}`).get(),
    db.doc(`families/${target.familyId}/members/${target.personId}`).get(),
    db.collection('sourceAccounts').where('familyId', '==', target.familyId).get(),
  ])
  if (!familySnap.exists || !childSnap.exists || !memberSnap.exists) return null
  const family = { ...familySnap.data(), id: target.familyId }
  const child = { ...childSnap.data(), id: target.childId }
  const member = { ...memberSnap.data(), id: target.personId }
  if (!isActiveFamilyChild({ familyId: target.familyId, childId: target.childId, family, child })
    || !isActiveParentForChild(member, target.childId) || !safeId(child.meshPersonId)) return null
  const identitySnap = await db.doc(`sourceIdentities/${meshChildIdentityId(child.meshPersonId)}`).get()
  const identity = identitySnap.exists ? { ...identitySnap.data(), id: identitySnap.id ?? meshChildIdentityId(child.meshPersonId) } : null
  const account = (accountQuery.docs ?? []).find((document) => {
    const row = { ...document.data(), id: document.id }
    return isOwnedMeshAccount({ familyId: target.familyId, childId: target.childId,
      sourcePersonId: child.meshPersonId, sourceAccountId: document.id,
      family, child, identity, account: row, member })
  })
  if (!account) return null
  return Object.freeze({ source: 'mesh', familyId: target.familyId, childId: target.childId,
    sourceAccountId: account.id, sourcePersonId: child.meshPersonId, kind: 'schedule', date })
}

export function opaqueLinkDigest(linkId) { return hash(linkId) }
function hash(value) { return createHash('sha256').update(String(value)).digest('hex').slice(0, 16) }
function safeId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }
function validTelegramId(value) { return /^\d{1,20}$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 }
function validDay(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) }
