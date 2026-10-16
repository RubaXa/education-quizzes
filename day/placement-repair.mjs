import { placementIntegrityErrors } from './placement-integrity.mjs'

/** A migration of one edge only. Other page fields, attempts and role links stay intact.
 * @see ../docs/shared/data/firestore.md#migration */
export function repairTaskPlacements(page) {
  const tasks = new Map((page.subjects ?? []).flatMap((subject) => (subject.tasks ?? [])
    .map((task) => [task.id, { task, subjectId: subject.id }])))
  const seenTasks = new Set()
  const placements = []
  for (const placement of page.testPlacements ?? []) {
    if (!placement.taskId) { placements.push(placement); continue }
    const owner = tasks.get(placement.taskId)
    if (!owner || !owner.task.testToken || owner.subjectId !== placement.subjectId
      || owner.task.testToken !== placement.token || seenTasks.has(placement.taskId)) continue
    seenTasks.add(placement.taskId)
    placements.push(placement)
  }
  for (const [taskId, { task, subjectId }] of tasks) if (task.testToken && !seenTasks.has(taskId)) {
    placements.push({ taskId, subjectId, token: task.testToken })
  }
  const next = { ...page, testPlacements: placements }
  const errors = placementIntegrityErrors(next)
  if (errors.length) throw new Error(`Миграция не может восстановить страницу: ${errors.join(' ')}`)
  return next
}
