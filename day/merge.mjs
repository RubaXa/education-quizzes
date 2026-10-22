import { isExplicitCdzTask } from './homework-kind.mjs'
import { canPublishSourceOnly } from './source-only.mjs'

/** @see ../docs/modules/synchronization/plan-generation.md#source-only-publication
 * @see ../docs/decisions/day-merge-order-2026-10-22.md
 * @see ../docs/decisions/source-only-mesh-publication-2026-10-20.md */

function stripSourceOnlyEnrichment(task) {
  for (const key of ['steps', 'submission', 'parentGuide', 'problems', 'practiceVariants', 'cardPattern',
    'outputKind', 'testToken', 'testSlug', 'requiredPoints', 'assessmentIntent', 'sourceInventory']) delete task[key]
  return task
}

function uniqueBy(items, key) {
  return [...new Map(items.map((item) => [key(item), item])).values()]
}

function withoutSiteCopies({ siteImage, siteThumbnail, ...link }) {
  return link
}

function mergeSubjects(existing = [], incoming = [], retiredTaskIds = new Set()) {
  const previousById = new Map(existing.map((subject) => [subject.id, {
    ...subject, tasks: subject.tasks.filter((task) => !retiredTaskIds.has(task.id)),
  }]))
  const includedIds = new Set()
  const result = incoming.map((subject) => {
    includedIds.add(subject.id)
    const older = previousById.get(subject.id)
    if (!older) return subject

    const previousTasks = new Map(older.tasks.map((task) => [task.id, task]))
    const incomingIds = new Set()
    const tasks = subject.tasks.map((task) => {
      incomingIds.add(task.id)
      const old = previousTasks.get(task.id)
      if (!old) return task
      const sameCondition = old.meshText === task.meshText && old.kind === task.kind
      const merged = sameCondition ? { ...old, ...task } : { ...task }
      if (canPublishSourceOnly(task)) stripSourceOnlyEnrichment(merged)
      merged.status = sameCondition && task.status === 'unknown' && old.status !== 'unknown' ? old.status : task.status
      if (!isExplicitCdzTask(merged)) delete merged.platformResult
      return merged
    })
    // Source order is canonical. Work absent from the new source snapshot stays
    // attached to the subject after the incoming tasks, unless explicitly retired.
    for (const task of older.tasks) if (!incomingIds.has(task.id)) tasks.push(task)
    return { ...older, ...subject, tasks }
  })
  // Preserve historical subjects that disappeared from the source snapshot at
  // the end, in their original order. Empty historical subjects remain omitted.
  for (const subject of existing) {
    if (includedIds.has(subject.id)) continue
    const retained = previousById.get(subject.id)
    if (retained?.tasks.length) result.push(retained)
  }
  return result
}

function sequenceChanged(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after)
}

/** @see ../docs/modules/families/access-and-state.md#state */
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
  // @see ../docs/modules/assessments/quizzes.md#quiz-results
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
    practiceVariantIds: after.flatMap((task) => (task.practiceVariants || []).map((variant) => variant.id)),
    testPlacements: uniqueBy([...retainedPlacements, ...(incoming.testPlacements || [])], (item) => item.token),
    evidenceDayTokens: [...new Set([...(existing.evidenceDayTokens || []), ...(incoming.evidenceDayTokens || [])])],
  }
  const newLinks = Object.entries(materialLinks).some(([id, links]) => JSON.stringify(links) !== JSON.stringify(existing.materialLinks?.[id] || []))
  const changedSubjects = subjects.filter((subject) => {
    const old = existing.subjects.find((item) => item.id === subject.id)
    return old && ['mesh', 'materials', 'summary', 'name'].some((key) => old[key] !== subject[key])
  }).map((subject) => subject.id)
  const subjectOrderChanged = sequenceChanged(existing.subjects.map((subject) => subject.id), subjects.map((subject) => subject.id))
  const taskOrderChanged = subjects.filter((subject) => {
    const old = existing.subjects.find((item) => item.id === subject.id)
    return old && sequenceChanged(old.tasks.map((task) => task.id), subject.tasks.map((task) => task.id))
  }).map((subject) => subject.id)
  const changedSchedule = JSON.stringify(existing.todaySchedule) !== JSON.stringify(incoming.todaySchedule)
    || JSON.stringify(existing.targetSchedule) !== JSON.stringify(incoming.targetSchedule)
  const changedWeekendSlot = JSON.stringify(existing.weekendSlot ?? null) !== JSON.stringify(incoming.weekendSlot ?? null)
  const planChanged = added.length || removed.length || changed.length || changedSubjects.length
    || subjectOrderChanged || taskOrderChanged.length || newLinks || changedSchedule || changedWeekendSlot
  merged.planRevision = (existing.planRevision || 1) + (planChanged ? 1 : 0)
  merged.changes = planChanged
    ? [{ at: incoming.updatedAt, added, removed, changed, changedSubjects, subjectOrderChanged, taskOrderChanged,
      newLinks, changedSchedule, changedWeekendSlot }, ...(existing.changes || [])].slice(0, 20)
    : existing.changes || []
  return merged
}
