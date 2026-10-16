import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'

/** One changing review notice per attempt; separate immutable notices for corrections and releases.
 * @see ../docs/modules/notifications/inbox.md#notification-producers
 */
export function notificationId(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 40)
}

export function reviewAttemptKey(ownerId, uploadIds, taskIds) {
  return `review:${ownerId}:${[...uploadIds].sort().join(',')}:${[...taskIds].sort().join(',')}`
}

export function taskContext(page, taskId) {
  for (const subject of page.subjects ?? []) for (const task of subject.tasks ?? []) {
    if (task.id === taskId) return { subject: subject.name, title: task.title }
    const problem = task.problems?.find((item) => item.id === taskId)
    if (problem) return { subject: subject.name, title: `№ ${problem.number}. ${problem.title}` }
  }
  return { subject: '', title: 'Работа' }
}

export async function stageFamilyNotice(db, batch, { familyId, childId, roles = ['parent', 'student'], key, data, mode = 'replace' }) {
  const members = await db.collection(`families/${familyId}/members`).get()
  const id = notificationId(key)
  const recipients = members.docs.filter((member) => member.data().active === true
    && roles.includes(member.data().role) && member.data().childIds?.includes(childId))
  for (const member of recipients) {
    const ref = db.doc(`users/${member.id}/inbox/${id}`)
    const prior = (await ref.get()).data()
    if (mode === 'create' && prior || mode === 'start' && prior && prior.type !== 'review_paused') continue
    if (mode === 'replace' && prior?.type === data.type && prior?.sourceRevision === data.sourceRevision) continue
    batch.set(ref, { familyId, childId, ...data, createdAt: Timestamp.now() })
  }
  return recipients.length
}
