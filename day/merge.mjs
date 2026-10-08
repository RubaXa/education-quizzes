function uniqueBy(items, key) {
  return [...new Map(items.map((item) => [key(item), item])).values()]
}

function withoutSiteCopies({ siteImage, siteThumbnail, ...link }) {
  return link
}

function mergeSubjects(existing = [], incoming = []) {
  const result = existing.map((subject) => ({ ...subject, tasks: [...subject.tasks] }))
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
        tasks[position] = { ...old, ...task, status: task.status === 'unknown' && old.status !== 'unknown' ? old.status : task.status }
      }
    }
    result[index] = { ...older, ...subject, tasks }
  }
  return result
}

/** @see ../docs/product/access-and-state.md#state */
export function mergeDayPage(existing, incoming) {
  if (!existing) return { ...incoming, planRevision: 1, changes: [] }
  const subjects = mergeSubjects(existing.subjects, incoming.subjects)
  const before = new Map(existing.subjects.flatMap((subject) => subject.tasks).map((task) => [task.id, task]))
  const after = subjects.flatMap((subject) => subject.tasks)
  const added = after.filter((task) => !before.has(task.id)).map((task) => task.id)
  const changed = after.filter((task) => before.has(task.id) && JSON.stringify(before.get(task.id)) !== JSON.stringify(task)).map((task) => task.id)
  const materialLinks = Object.fromEntries(Object.entries(existing.materialLinks || {}).map(([taskId, links]) => [taskId, links.map(withoutSiteCopies)]))
  const replacements = new Set(incoming.materialLinkReplacements || [])
  for (const [taskId, links] of Object.entries(incoming.materialLinks || {})) {
    const current = links.map(withoutSiteCopies)
    materialLinks[taskId] = replacements.has(taskId) ? current : uniqueBy([...(materialLinks[taskId] || []), ...current], (item) => item.url)
  }
  for (const taskId of replacements) if (!(taskId in (incoming.materialLinks || {}))) materialLinks[taskId] = []
  const merged = {
    ...existing, ...incoming, subjects,
    taskIds: after.map((task) => task.id), materialLinks,
    testPlacements: uniqueBy([...(existing.testPlacements || []), ...(incoming.testPlacements || [])], (item) => item.token),
    evidenceDayTokens: [...new Set([...(existing.evidenceDayTokens || []), ...(incoming.evidenceDayTokens || [])])],
  }
  const newLinks = Object.entries(materialLinks).some(([id, links]) => JSON.stringify(links) !== JSON.stringify(existing.materialLinks?.[id] || []))
  const changedSubjects = subjects.filter((subject) => {
    const old = existing.subjects.find((item) => item.id === subject.id)
    return old && ['mesh', 'materials', 'summary', 'name'].some((key) => old[key] !== subject[key])
  }).map((subject) => subject.id)
  const changedSchedule = JSON.stringify(existing.todaySchedule) !== JSON.stringify(incoming.todaySchedule)
    || JSON.stringify(existing.targetSchedule) !== JSON.stringify(incoming.targetSchedule)
  const planChanged = added.length || changed.length || changedSubjects.length || newLinks || changedSchedule
  merged.planRevision = (existing.planRevision || 1) + (planChanged ? 1 : 0)
  merged.changes = planChanged
    ? [{ at: incoming.updatedAt, added, changed, changedSubjects, newLinks, changedSchedule }, ...(existing.changes || [])].slice(0, 20)
    : existing.changes || []
  return merged
}
