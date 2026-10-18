import { createHash } from 'node:crypto'

/** @see ../../../docs/services/telegram-bot/identity-and-linking.md#данные-и-доступ */
export function createFirestoreProbeRecipientResolver(db) {
  if (!db) throw new Error('probe_recipient_store_unavailable')
  return Object.freeze({ async resolve({ digest, familyId, childId }) {
    if (!/^[a-f0-9]{16}$/.test(digest ?? '') || !validId(familyId) || !validId(childId)) return null
    const links = await db.collection('telegramBotFamilyLinks').where('familyId', '==', familyId).get()
    const matched = links.docs.filter((doc) => opaqueLinkDigest(doc.id) === digest)
    if (matched.length !== 1) return null
    const doc = matched[0]
    const link = doc.data()
    if (link?.status !== 'active' || link.familyId !== familyId || !validId(link.personId)
      || !validTelegramUserId(link.telegramUserId)) return null
    const [account, member] = await Promise.all([
      db.doc(`telegramBotAccounts/${link.telegramUserId}`).get(),
      db.doc(`families/${familyId}/members/${link.personId}`).get(),
    ])
    if (!account.exists || !member.exists) return null
    const accountData = account.data(), memberData = member.data()
    if (accountData?.status === 'disconnected' || (accountData?.channelStatus ?? 'available') !== 'available'
      || memberData?.active !== true || memberData.role !== 'parent'
      || !Array.isArray(memberData.childIds) || !memberData.childIds.includes(childId)) return null
    return Object.freeze({ linkId: doc.id, familyId, personId: link.personId, telegramUserId: String(link.telegramUserId), childId })
  } })
}

export function opaqueLinkDigest(linkId) { return createHash('sha256').update(String(linkId)).digest('hex').slice(0, 16) }
function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }
function validTelegramUserId(value) { return /^\d{1,20}$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0 }
