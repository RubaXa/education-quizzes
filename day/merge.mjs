import { isExplicitCdzTask } from './homework-kind.mjs'

function uniqueBy(items, key) {
  return [...new Map(items.map((item) => [key(item), item])).values()]
}

function withoutSiteCopies({ siteImage, siteThumbnail, ...link }) {
  return link
}

function mergeSubjects(existing = [], incoming = [], retiredTaskIds = new Set()) {
  const result = existing.map((subject) => ({ ...subject, tasks: subject.tasks.filter((task) => !retiredTaskIds.has(task.id)) }))
  for (const subject of incoming) {
    const index = result.findIndex((item) => item.id === subject.id)
    if (index < 0) { result.push(subject); continue }
    const older = result[index]
    const tasks = [...older.tasks]
    for (const task of subject.tasks) {
      const position = tasks.findIndex((item) => item.id === task.id)
      if (position < 0) tasks.push(task)
      else {
        const old = tasks[position]
        const sameCondition = old.meshText === task.meshText && old.kind === task.kind
        const merged = sameCondition ? { ...old, ...task } : { ...task }
        merged.status = sameCondition && task.status === 'unknown' && old.status !== 'unknown' ? old.status : task.status
        if (!isExplicitCdzTask(merged)) delete merged.platformResult
        tasks[position] = merged
      }
    }
    result[index] = { ...older, ...subject, tasks }
  }
  return result.filter((subject) => subject.tasks.length || incoming.some((item) => item.id === subject.id))
}

/** @see ../docs/product/access-and-state.md#state */
export function mergeDayPage(existing, incoming) {
  if (!existing) return { ...incoming, planRevision: 1, changes: [] }
  const retiredTaskIds = new Set([...(incoming.sourceOnlyEntries || []).map((entry) => entry.id), ...(incoming.retiredTaskIds || [])])
  const subjects = mergeSubjects(existing.subjects, incoming.subjects, retiredTaskIds)
  const before = new Map(existing.subjects.flatMap((subject) => subject.tasks).map((task) => [task.id, task]))
  const after = subjects.flatMap((subject) => subject.tasks)
  const added = after.filter((task) => !before.has(task.id)).map((task) => task.id)
  const removed = [...retiredTaskIds].filter((taskId) => before.has(taskId) && !after.some((task) => task.id === taskId))
  const changed = after.filter((task) => before.has(task.id) && JSON.stringify(before.get(task.id)) !== JSON.stringify(task)).map((task) => task.id)
  const materialLinks = Object.fromEntries(Object.entries(existing.materialLinks || {}).filter(([taskId]) => !retiredTaskIds.has(taskId)).map(([taskId, links]) => [taskId, links.map(withoutSiteCopies)]))
  const replacements = new Set(incoming.materialLinkReplacements || [])
  for (const [taskId, links] of Object.entries(incoming.materialLinks || {})) {
    const current = links.map(withoutSiteCopies)
    materialLinks[taskId] = replacements.has(taskId) ? current : uniqueBy([...(materialLinks[taskId] || []), ...current], (item) => item.url)
  }
  for (const taskId of replacements) if (!(taskId in (incoming.materialLinks || {}))) materialLinks[taskId] = []
  // A republished task owns its test placement. Keeping the previous token
  // would make one task point at both the corrected and the stale assignment.
  // @see ../docs/product/quizzes.md#quiz-results
  const replacedPlacementTasks = new Set([
    ...retiredTaskIds,
    ...incoming.subjects.flatMap((subject) => subject.tasks.map((task) => task.id)),
    ...(incoming.testPlacements || []).map((placement) => placement.taskId).filter(Boolean),
  ])
  const retainedPlacements = (existing.testPlacements || [])
    .filter((placement) => !placement.taskId || !replacedPlacementTasks.has(placement.taskId))
  const merged = {
    ...existing, ...incoming, subjects,
    taskIds: after.flatMap((task) => [task.id, ...(task.problems || []).map((problem) => problem.id)]), materialLinks,
    testPlacements: uniqueBy([...retainedPlacements, ...(incoming.testPlacements || [])], (item) => item.token),
    evidenceDayTokens: [...new Set([...(existing.evidenceDayTokens || []), ...(incoming.evidenceDayTokens || [])])],
  }
  const newLinks = Object.entries(materialLinks).some(([id, links]) => JSON.stringify(links) !== JSON.stringify(existing.materialLinks?.[id] || []))
  const changedSubjects = subjects.filter((subject) => {
    const old = existing.subjects.find((item) => item.id === subject.id)
    return old && ['mesh', 'materials', 'summary', 'name'].some((key) => old[key] !== subject[key])
  }).map((subject) => subject.id)
  const changedSchedule = JSON.stringify(existing.todaySchedule) !== JSON.stringify(incoming.todaySchedule)
    || JSON.stringify(existing.targetSchedule) !== JSON.stringify(incoming.targetSchedule)
  const changedWeekendSlot = JSON.stringify(existing.weekendSlot ?? null) !== JSON.stringify(incoming.weekendSlot ?? null)
  const planChanged = added.length || removed.length || changed.length || changedSubjects.length || newLinks || changedSchedule || changedWeekendSlot
  merged.planRevision = (existing.planRevision || 1) + (planChanged ? 1 : 0)
  merged.changes = planChanged
    ? [{ at: incoming.updatedAt, added, removed, changed, changedSubjects, newLinks, changedSchedule, changedWeekendSlot }, ...(existing.changes || [])].slice(0, 20)
    : existing.changes || []
  return merged
}
