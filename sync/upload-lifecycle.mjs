/** @see ../docs/decisions/upload-lifecycle-continuation-2026-10-30.md */
/** @see ../docs/modules/synchronization/event-queue.md#upload-lifecycle */
import { Timestamp } from '@google-cloud/firestore'
import { createEducationEventId } from '../packages/education-events/envelope.mjs'
import { syncJobId } from './job-queue.mjs'

const waitReasons = new Set(['source-unavailable', 'notebook-topic-needed', 'awaiting-student-material'])

/** Read exactly one request's known dependent jobs, without discovering other work. */
export async function sourceMaterialWaits(db, event, inputs) {
  const request = inputs.context?.task?.materialRequest
  if (event.eventType !== 'upload.confirmed' || inputs.route.next !== 'review-source-material' || request?.state !== 'open') return []
  const taskId = inputs.context.task.id, date = inputs.context.dueDate
  const waits = []
  for (const kind of ['classify-assignment', 'enrich-task', 'material-needed']) {
    const id = syncJobId(kind, event.familyId, event.childId, `${date}:${taskId}`)
    const job = (await db.doc(`operatorSyncJobs/${id}`).get()).data()
    if ((job?.status === 'blocked' && waitReasons.has(job.reason) || job?.status === 'processing' && job.materialRequestId === request.id && job.phase === 'source-material-received') && job.familyId === event.familyId && job.childId === event.childId
      && job.source?.dayToken === event.sourceRef.dayToken && job.source?.taskId === taskId) {
      waits.push({ id, fingerprint: job.fingerprint, requestId: request.id })
    }
  }
  return waits
}

export async function uploadDeletionRef(db, event) {
  const sourceRef = event.sourceRef
  const eventId = await createEducationEventId({ ...event, eventType: 'upload.delete_requested', sourceRef,
    operationId: `upload-delete:${sourceRef.recordId}` })
  return db.doc(`educationEvents/${eventId}`)
}

/** Close only active jobs for this owned upload. Missing source alone is never proof of deletion. */
export async function withdrawUploadWork(db, event, now = Timestamp.now()) {
  if (event.eventType !== 'upload.delete_requested' || event.source !== 'firestore'
    || event.sourceRef?.kind !== 'upload') throw new Error('invalid_upload_withdrawal')
  const ref = event.sourceRef
  if (ref.documentPath !== `dayUploads/${ref.dayToken}/files/${ref.recordId}`) throw new Error('invalid_upload_withdrawal')
  const ownerRef = db.doc(`dayOwners/${ref.dayToken}`)
  const sourceRef = db.doc(ref.documentPath)
  const exactJobs = db.collection('operatorSyncJobs').where('sourceRef.documentPath', '==', ref.documentPath)
  const legacyJobs = db.collection('operatorSyncJobs').where('source.id', '==', ref.recordId)
  const confirmedId = await createEducationEventId({ ...event, eventType: 'upload.confirmed', operationId: `upload-confirmed:${ref.recordId}` })
  const resumedJobs = db.collection('operatorSyncJobs').where('resumedByEventId', '==', confirmedId)
  return db.runTransaction(async tx => {
    const [owner, source, exact, legacy, resumed] = await Promise.all([tx.get(ownerRef), tx.get(sourceRef), tx.get(exactJobs), tx.get(legacyJobs), tx.get(resumedJobs)])
    if (owner.data()?.familyId !== event.familyId || owner.data()?.childId !== event.childId) throw new Error('upload_withdrawal_owner_changed')
    if (source.exists && source.data()?.status !== 'deleted') return { withdrawn: 0 }
    for (const doc of resumed.docs) {
      const job = doc.data()
      if (job.familyId !== event.familyId || job.childId !== event.childId || job.status !== 'processing'
        || job.phase !== 'source-material-received' || job.source?.dayToken !== ref.dayToken || job.source?.taskId !== ref.taskId) continue
      tx.update(doc.ref, { status: 'blocked', phase: 'awaiting-student-material', reason: 'awaiting-student-material',
        updatedAt: now, resumedByEventId: null, evidence: `educationEvents/${event.eventId}` })
    }
    let withdrawn = 0
    const jobs = new Map([...exact.docs, ...legacy.docs].map(doc => [doc.id, doc]))
    for (const doc of jobs.values()) {
      const job = doc.data()
      if (job.familyId !== event.familyId || job.childId !== event.childId || !['review-work', 'transfer-work', 'repair-review', 'investigate-work'].includes(job.kind)
        || !['queued', 'processing', 'blocked'].includes(job.status)) continue
      const exact = job.sourceRef?.documentPath === ref.documentPath
        || job.source?.dayToken === ref.dayToken && job.source?.id === ref.recordId
      if (!exact) continue
      tx.update(doc.ref, { status: 'done', phase: 'source-withdrawn', reason: null, completedAt: now, updatedAt: now,
        evidence: `educationEvents/${event.eventId}` })
      withdrawn++
    }
    return { withdrawn }
  })
}
