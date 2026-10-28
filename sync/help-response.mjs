/** Publish one response to one immutable request through the shared guidance collection.
 * @see ../docs/modules/synchronization/event-queue.md
 * @see ../docs/modules/assessments/olympiad-preparation.md#модель-урока-и-свидетельств
 */
import { syncJobId } from './job-queue.mjs'
import { captureEventTaskInputs, taskArtifactFingerprint, validateTaskArtifact } from './event-task-artifact.mjs'

const hash = value => /^[a-f0-9]{64}$/.test(value ?? '')
const fail = code => { throw Object.assign(new Error(code), { safeCode: code }) }

/** Re-read the exact captured evidence in the same transaction as response creation.
 * Only the trusted operator may call this function; the client cannot write this form.
 */
export async function publishHelpResponse(db, { eventId, artifactId, text, now = new Date().toISOString() }) {
  if (!hash(eventId) || !hash(artifactId) || typeof text !== 'string' || !text.trim() || text.length > 12000
    || !Number.isFinite(Date.parse(now))) fail('help_response_invalid')
  const trimmed = text.trim()
  const result = await db.runTransaction(async tx => {
    const eventRef = db.doc(`educationEvents/${eventId}`), artifactRef = db.doc(`operatorSyncTaskArtifacts/${artifactId}`)
    const [eventSnap, artifactSnap] = await Promise.all([tx.get(eventRef), tx.get(artifactRef)])
    if (!eventSnap.exists || !artifactSnap.exists) fail('help_response_source_missing')
    const event = eventSnap.data(), artifact = artifactSnap.data()
    if (event.eventId !== eventId || event.eventType !== 'help.requested' || artifact.eventId !== eventId
      || artifact.artifactId !== artifactId || validateTaskArtifact(artifact, { eventId, now: artifact.verifiedAt }).state !== 'ready') fail('help_response_artifact_invalid')
    const dayToken = event.sourceRef?.dayToken, taskId = event.sourceRef?.taskId
    const responseRef = db.doc(`dayGuidance/${dayToken}/items/help-${eventId}`)
    const jobRef = db.doc(`operatorSyncJobs/${syncJobId('triage-help', event.familyId, event.childId, eventId)}`)
    const [existing, jobSnap] = await Promise.all([tx.get(responseRef), tx.get(jobRef)])
    const job = jobSnap.data()
    if (!jobSnap.exists || job?.kind !== 'triage-help' || job.eventId !== eventId || job.sourceId !== eventId
      || job.familyId !== event.familyId || job.childId !== event.childId || job.artifactPath !== artifactRef.path
      || job.fingerprint !== artifact.fingerprint || !['queued', 'processing', 'blocked', 'done'].includes(job.status)) fail('help_response_job_changed')
    if (existing.exists) {
      const current = existing.data()
      if (current.sourceRequestEventId !== eventId || current.sourceArtifactId !== artifactId || current.text !== trimmed
        || job.status !== 'done' || job.evidence !== responseRef.path) fail('help_response_conflict')
      return { path: responseRef.path, jobPath: jobRef.path, unchanged: true }
    }
    if (job.status === 'done') fail('help_response_job_changed')
    if (validateTaskArtifact(artifact, { eventId, now }).state !== 'ready') fail('help_response_artifact_invalid')
    const transactionalDb = { doc: path => ({ get: () => tx.get(db.doc(path)) }) }
    const inputs = await captureEventTaskInputs(transactionalDb, event)
    if (!Array.isArray(inputs.source.photoUploadIds) || !Number.isInteger(inputs.source.planRevision)
      || taskArtifactFingerprint({ eventId, inputs }) !== artifact.fingerprint) fail('help_response_source_changed')
    const response = { taskId, stageId: 'help-response', stageIndex: 0, level: 'reveal', text: trimmed,
      guideRevision: inputs.source.revision, actorPersonId: 'education-operator', createdAt: new Date(now),
      sourceRequestEventId: eventId, sourceArtifactId: artifactId, sourceFingerprint: artifact.fingerprint,
      sourcePlanRevision: inputs.source.planRevision }
    tx.create(responseRef, response)
    tx.update(jobRef, { status: 'done', phase: 'verified', evidence: responseRef.path, updatedAt: new Date(now), completedAt: new Date(now) })
    return { path: responseRef.path, jobPath: jobRef.path, unchanged: false }
  })
  const [saved, savedJob] = await Promise.all([db.doc(result.path).get(), db.doc(result.jobPath).get()])
  if (!saved.exists || saved.data()?.sourceRequestEventId !== eventId || saved.data()?.sourceArtifactId !== artifactId
    || saved.data()?.text !== trimmed || !savedJob.exists || savedJob.data()?.status !== 'done'
    || savedJob.data()?.eventId !== eventId || savedJob.data()?.evidence !== result.path) fail('help_response_readback_failed')
  return { eventId, artifactId, verified: true, unchanged: result.unchanged }
}
