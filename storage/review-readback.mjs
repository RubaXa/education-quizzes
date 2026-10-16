/** @see ../docs/product/material-clarification.md */
import { isDeepStrictEqual } from 'node:util'
/** Verify only the documents changed by one review publication.
 * @see ../docs/architecture/operator-core.md#execution */
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
  }
  if (uploads.some((upload) => upload?.status !== 'reviewed')) throw new Error('Review upload status was not read back.')
  return { reviewedTasks: entries.length, reviewedUploads: uploads.length, verified: true }
}
