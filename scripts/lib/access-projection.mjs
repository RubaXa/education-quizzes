import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'

const site = 'https://rubaxa.github.io/education-quizzes/'
export const grantId = (token) => createHash('sha256').update(token).digest('hex')

/** Rebuild a parent's view from operator-owned grants; never change learner work.
 * @see ../../docs/modules/families/README.md#link-rotation */
export async function syncChildAccess(db, registry, familyId, childId) {
  const people = Object.entries(registry.people).filter(([, item]) => item.familyId === familyId
    && item.childId === childId && item.role === 'student')
  let count = 0
  for (const [personId] of people) {
    for (const token of registry.links[personId] ?? []) {
      const [grant, sessions] = await Promise.all([
        db.doc(`accessLinks/${token}`).get(),
        db.collection('deviceSessions').where('linkToken', '==', token).count().get(),
      ])
      if (!grant.exists || grant.data().personId !== personId) throw new Error('Личная ссылка ребёнка не совпала с локальным реестром.')
      await db.doc(`families/${familyId}/children/${childId}/accessGrants/${grantId(token)}`).set({
        personId, linkUrl: `${site}#/enter/${token}`,
        active: grant.data().active === true,
        createdAt: grant.data().createdAt ?? null,
        revokedAt: grant.data().revokedAt ?? null,
        sessionCount: sessions.data().count,
        checkedAt: Timestamp.now(),
      })
      count++
    }
  }
  return count
}
