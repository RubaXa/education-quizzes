/** @see ../docs/decisions/personal-tutoring-2026-10-30.md */
/** @see ../docs/modules/materials/material-clarification.md */
import { isDeepStrictEqual } from 'node:util'
import { studentReviewProjection } from './review-projection.mjs'
/** A guidance/context edit may change a page revision without changing the task. */
export function sameReviewAssignmentAfterUpdate(page, correction, currentTask) {
  return page.planRevision > correction.planRevision && Boolean(
    correction.meshText?.trim() && currentTask?.meshText === correction.meshText
    || correction.familySourceId && correction.familySourceId === currentTask?.familyOrigin?.sourceId
      && correction.assignmentText?.trim() && correction.assignmentText === currentTask.detail)
}
export function reviewCorrectionStatusAllowed(previous, next) {
  return previous === next || ['partial:verified', 'partial:cannot-assess', 'needs-fix:cannot-assess',
    'cannot-assess:verified', 'needs-fix:partial'].includes(`${previous}:${next}`)
}
/** Verify only the documents changed by one review publication.
 * @see ../docs/services/operator-cli/README.md#execution */
export function assertReviewReadback({ entries, planRevision, privateDocs, publicDocs, uploads }) {
  if (entries.length !== privateDocs.length || entries.length !== publicDocs.length || !uploads.length) {
    throw new Error('Incomplete review readback.')
  }
  for (const [index, entry] of entries.entries()) {
    const expert = privateDocs[index]
    const learner = publicDocs[index]
    if (entry.purpose === 'source-material' && (expert?.purpose !== entry.purpose || learner?.purpose !== entry.purpose
      || !isDeepStrictEqual(expert.sourceAnalysis, entry.sourceAnalysis) || !isDeepStrictEqual(learner.sourceAnalysis, entry.sourceAnalysis))) throw new Error(`Source material publication differs for ${entry.taskId}.`)
    if (expert?.taskId !== entry.taskId || learner?.taskId !== entry.taskId
      || expert?.status !== entry.status || learner?.status !== entry.status
      || expert?.planRevision !== planRevision || learner?.planRevision !== planRevision) {
      throw new Error(`Review publication differs for ${entry.taskId}.`)
    }
    for (const key of ['uploadIds', 'sourceAnalysis', 'summary', 'nextStep', 'source', 'items',
      'checkableStageIds', 'requirementChecks', 'mathReasoning', 'studentFeedback', 'assessmentBasis',
      'challengeReview', 'tutoringPlan']) {
      if (Object.hasOwn(entry, key) && !isDeepStrictEqual(expert[key], entry[key])) {
        throw new Error(`Review content differs for ${entry.taskId}: ${key}.`)
      }
    }
    if (!isDeepStrictEqual(studentReviewProjection(expert), learner)) {
      throw new Error(`Learner projection differs for ${entry.taskId}.`)
    }
  }
  if (uploads.some((upload) => upload?.status !== 'reviewed')) throw new Error('Review upload status was not read back.')
  return { reviewedTasks: entries.length, reviewedUploads: uploads.length, verified: true }
}
