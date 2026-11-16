/** @see ../docs/modules/assignments/README.md#readiness-and-handover */
import { learningGate } from '../day/learning-gate.mjs'

export async function readWorkEvidence(db, { owner, token, taskIds }) {
  const selectedIds = [...new Set(taskIds ?? [])]
  if (!selectedIds.length || selectedIds.length !== taskIds.length) throw new Error('work_evidence_invalid_selection')
  const [pageSnap, ownerSnap] = await db.getAll(db.doc(`dayPages/${token}`), db.doc(`dayOwners/${token}`))
  const page = pageSnap.data(), storedOwner = ownerSnap.data()
  if (!owner?.familyId || !owner?.childId || [page, storedOwner].some(value => value?.familyId !== owner.familyId || value?.childId !== owner.childId) || page.kind !== 'student') throw new Error('work_evidence_owner_mismatch')
  const tasks = (page.subjects ?? []).flatMap(subject => subject.tasks ?? []).filter(task => taskIds.includes(task.id))
  if (tasks.length !== taskIds.length) throw new Error('work_evidence_task_missing')
  const requiredIds = tasks.flatMap(task => task.problems?.length ? task.problems.map(problem => problem.id) : [task.id])
  const uploadTaskIds = [...new Set([...taskIds, ...requiredIds])]
  if (!requiredIds.length || uploadTaskIds.length > 30) throw new Error('work_evidence_selection_too_large')
  const records = await db.getAll(...requiredIds.map(id => db.doc(`dayProgress/${token}/items/${id}`)))
  const reviews = records.map((record, index) => ({ ...record.data(), taskId: requiredIds[index] }))
  const uploads = (await db.collection(`dayUploads/${token}/files`).where('taskId', 'in', uploadTaskIds).get()).docs.map(record => ({ ...record.data(), id: record.id }))
  const pendingUploadIds = uploads.filter(file => ['requested', 'awaiting-upload', 'uploaded', 'pending'].includes(file.status)).map(file => file.id)
  return { ...owner, token, sourceDate: page.date, targetDate: page.targetDate, checkedAt: new Date().toISOString(), tasks, reviews, uploads,
    gate: learningGate({ prepared: tasks.every(task => task.instructionStatus?.state === 'reviewed'), requiredIds, reviews, pendingUploadIds }) }
}
