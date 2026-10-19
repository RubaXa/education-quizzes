import { createHash } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { createEducationEvent } from '../packages/education-events/envelope.mjs'

/** Add one idempotent shared-queue event for each published review projection.
 * @see ../docs/modules/synchronization/event-queue.md
 */
export async function stageReviewPublishedEvents(db, batch, owner, entries) {
  const events = await Promise.all(entries.map(async (entry) => {
    const revision = createHash('sha256').update(JSON.stringify(entry)).digest('hex')
    const operationId = `review-published:${owner.id}:${entry.taskId}:${revision}`
    const sourceRef = { kind: 'review', documentPath: `dayProgress/${owner.id}/items/${entry.taskId}`, dayToken: owner.id, taskId: entry.taskId }
    const envelope = await createEducationEvent({ eventType: 'review.published', familyId: owner.data().familyId,
      childId: owner.data().childId, source: 'firestore', sourceRef, operationId,
      actor: { type: 'system', id: 'submissions' } }, FieldValue.serverTimestamp())
    return { entry, envelope }
  }))
  const existingEvents = await Promise.all(events.map(({ envelope }) => db.doc(`educationEvents/${envelope.eventId}`).get()))
  events.forEach(({ entry, envelope }, index) => {
    if (existingEvents[index].exists) {
      const existing = existingEvents[index].data()
      if (existing?.eventType !== envelope.eventType || existing?.operationId !== envelope.operationId
        || existing?.sourceRef?.documentPath !== envelope.sourceRef.documentPath) {
        throw new Error(`Conflicting education event receipt for review ${entry.taskId}.`)
      }
    } else batch.create(db.doc(`educationEvents/${envelope.eventId}`), envelope)
  })
  return events.map(({ envelope }) => envelope.eventId)
}
