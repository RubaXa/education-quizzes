/** @see ../docs/decisions/adaptive-review-modes-2026-11-17.md */
import {reviewResponseErrors,sameReviewValue,reviewSupportTransition} from '../packages/education-presentation/review-reply.mjs'
/** Publish one response to one immutable request through the shared guidance collection.
 * @see ../docs/modules/synchronization/event-queue.md
 * @see ../docs/modules/assessments/olympiad-preparation.md#модель-урока-и-свидетельств
 */
import { syncJobId } from './job-queue.mjs'
import { captureEventTaskInputs, taskArtifactFingerprint, validateTaskArtifact } from './event-task-artifact.mjs'
import {learningObservation} from './learning-observations.mjs'
/** @see ../docs/modules/reviews/criteria-and-knowledge.md#knowledge */

const hash = value => /^[a-f0-9]{64}$/.test(value ?? '')
const fail = code => { throw Object.assign(new Error(code), { safeCode: code }) }

/** Re-read the exact captured evidence in the same transaction as response creation.
 * Only the trusted operator may call this function; the client cannot write this form.
 */
export async function publishHelpResponse(db, { eventId, artifactId, text, reviewResponse, decision, now = new Date().toISOString() }) {
  if (reviewResponse) {
    if (reviewResponseErrors(reviewResponse).length || decision?.semanticChecked!==true || decision?.noAnswerChecked!==true
      || typeof decision?.reason!=='string' || decision.reason.trim().length<20 || decision.reason.length>1200) fail('help_response_pedagogy_invalid')
    text=reviewResponse.message
  }
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
      if (current.clarification!==undefined&&current.clarification!==decision?.disposition)fail('help_response_conflict')
      if (current.sourceRequestEventId !== eventId || current.sourceArtifactId !== artifactId || current.text !== trimmed || !sameReviewValue(current.reviewResponse,reviewResponse)
        || job.status !== 'done' || job.evidence !== responseRef.path) fail('help_response_conflict')
      return { path: responseRef.path, jobPath: jobRef.path,knowledgePath:job.learningEvidencePath??null,knowledgeScope:current.clarification?'source-material':'micro-step', unchanged: true }
    }
    if (job.status === 'done') fail('help_response_job_changed')
    const observationSnap = await tx.get(db.doc(`operatorSyncTaskObservations/${eventId}`))
    const observation = observationSnap.exists ? observationSnap.data() : null
    if (validateTaskArtifact(artifact, { eventId, observation, now }).state !== 'ready') fail('help_response_artifact_invalid')
    const transactionalDb = { doc: path => ({ get: () => tx.get(db.doc(path)) }), collection:path=>({where:(...args)=>({get:()=>tx.get(db.collection(path).where(...args))})}) }
    const inputs = await captureEventTaskInputs(transactionalDb, event)
    if (!Number.isInteger(inputs.source.planRevision) || taskArtifactFingerprint({ eventId, inputs }) !== artifact.fingerprint
      || (inputs.source.reviewReply ? !reviewResponse : (inputs.source.requestKind!=='condition'&&!Array.isArray(inputs.source.photoUploadIds) || reviewResponse))) fail('help_response_source_changed')
    const condition=inputs.source.requestKind==='condition'&&!inputs.source.photoUploadIds&&!inputs.source.reviewReply
    if(condition&&(decision?.conditionChecked!==true||decision?.archiveChecked!==true||decision?.noAnswerChecked!==true||trimmed.length>480||!['clarified','ask-child','ask-parent'].includes(decision?.disposition)||typeof decision?.reason!=='string'||decision.reason.trim().length<20))fail('help_condition_decision_invalid')
    const support=inputs.source.reviewReply?reviewSupportTransition(inputs.source.reviewReply,reviewResponse):undefined
    const response = { taskId, stageId: 'help-response', stageIndex: 0, level: 'reveal', text: trimmed,
      guideRevision: inputs.source.revision, actorPersonId: 'education-operator', createdAt: new Date(now),
      sourceRequestEventId: eventId, sourceArtifactId: artifactId, sourceFingerprint: artifact.fingerprint,
      sourcePlanRevision: inputs.source.planRevision, ...(condition?{clarification:decision.disposition}:{}), ...(reviewResponse ? {reviewResponse,reviewContext:inputs.reviewContext,sourceStepId:inputs.source.reviewReply.sourceId} : {}) }
    const knowledge=learningObservation({owner:{familyId:event.familyId,childId:event.childId},taskId,attemptRef:`educationEvents/${eventId}`,sourceRevision:artifact.fingerprint,
      outcome:reviewResponse?.outcome??'support-published',scope:condition?'source-material':'micro-step',helpLevel:'guided'})
    const knowledgeRef=db.doc(`families/${event.familyId}/children/${event.childId}/learningEvidence/${knowledge.id}`)
    tx.create(knowledgeRef,{...knowledge,recordedAt:new Date(now)})
    tx.create(responseRef, response)
    tx.update(jobRef, { status: 'done', phase: 'verified', evidence: responseRef.path,learningEvidencePath:knowledgeRef.path, updatedAt: new Date(now), completedAt: new Date(now), ...(condition?{conditionDecision:{disposition:decision.disposition,reason:decision.reason,conditionChecked:true,archiveChecked:true}}:{}), ...(reviewResponse?{pedagogicalDecision:{support,outcome:reviewResponse.outcome,reason:decision.reason,semanticChecked:true,noAnswerChecked:true}}:{}) })
    return { path: responseRef.path, jobPath: jobRef.path,knowledgePath:knowledgeRef.path,knowledgeScope:knowledge.scope, unchanged: false }
  })
  const [saved, savedJob] = await Promise.all([db.doc(result.path).get(), db.doc(result.jobPath).get()])
  if(result.knowledgePath){const evidence=await db.doc(result.knowledgePath).get();if(!evidence.exists||evidence.data()?.scope!==result.knowledgeScope||evidence.data()?.mastery!=='not-inferred')fail('help_response_knowledge_readback_failed')}
  if (!saved.exists || saved.data()?.sourceRequestEventId !== eventId || saved.data()?.sourceArtifactId !== artifactId
    || saved.data()?.text !== trimmed || !sameReviewValue(saved.data()?.reviewResponse,reviewResponse) || !savedJob.exists || savedJob.data()?.status !== 'done'
    || savedJob.data()?.eventId !== eventId || savedJob.data()?.evidence !== result.path) fail('help_response_readback_failed')
  return { eventId, artifactId, verified: true, unchanged: result.unchanged }
}
