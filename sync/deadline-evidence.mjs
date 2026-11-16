/** @see ../docs/modules/assignments/deadline-control.md */
import { deadlineDecision } from './deadline-control.mjs'

export async function inspectDeadlinePage(db, { page, owner, token, today }) {
  if (page.kind !== 'student' || !owner?.familyId || !owner?.childId || page.familyId !== owner.familyId || page.childId !== owner.childId) throw new Error('deadline_owner_mismatch')
  const tasks = (page.subjects ?? []).flatMap(subject => (subject.tasks ?? []).map(task => ({ task, subjectId: subject.id })))
    .filter(({ task }) => deadlineDecision({ task, today, dueDate: task.dueDate ?? page.targetDate }))
  if (!tasks.length) return { checks: [], fetched: 0 }
  const [progress, uploads] = await Promise.all([
    db.collection(`dayProgress/${token}/items`).get(), db.collection(`dayUploads/${token}/files`).get(),
  ])
  const reviews = progress.docs.map(doc => ({ ...doc.data(), taskId: doc.id }))
  const checks = tasks.flatMap(({ task, subjectId }) => {
    const ids = new Set([task.id,...(task.problems ?? []).map(p => p.id)])
    const pendingUploadIds = uploads.docs.filter(doc => {
      const file = doc.data()
      return ['requested','awaiting-upload','uploaded','pending'].includes(file.status)
        && [file.taskId,...(file.coveredTaskIds ?? []),...(file.processingTaskIds ?? [])].some(id => ids.has(id))
    }).map(doc => doc.id)
    const result = deadlineDecision({ task, today, dueDate: task.dueDate ?? page.targetDate, reviews, pendingUploadIds })
    return result ? [{ taskId: task.id, subjectId, ...result, pendingUploadIds }] : []
  })
  return { checks, fetched: progress.size + uploads.size }
}
