/** An attachment belongs to one MESH assignment, even when several assignments
 * share a subject and lesson. A genuinely shared file needs explicit provenance
 * on every edge. @see ../docs/product/day-page.md#multiple-assignments */
export function teacherAttachmentOwnershipErrors(source) {
  const owners = new Map()
  for (const subject of source.subjects ?? []) for (const task of subject.tasks ?? []) {
    for (const link of source.materialLinks?.[task.id] ?? []) {
      if (link.sourceType !== 'teacher-attachment') continue
      const ref = link.sourceRef || link.url
      if (!ref) continue
      const edges = owners.get(ref) ?? []
      edges.push({ taskId: task.id, shared: link.sharedAcrossTasks === true, url: link.url, sourceSha256: link.sourceSha256 })
      owners.set(ref, edges)
    }
  }
  const errors = []
  for (const [ref, edges] of owners) {
    const taskIds = [...new Set(edges.map(({ taskId }) => taskId))]
    if (taskIds.length < 2) continue
    if (edges.every(({ shared }) => shared) && new Set(edges.map(({ url, sourceSha256 }) => `${url}:${sourceSha256 ?? ''}`)).size === 1) continue
    errors.push(`Лист ${ref} смешан между заданиями ${taskIds.join(' и ')}; укажите отдельного владельца или подтверждённый sharedAcrossTasks.`)
  }
  return errors
}

/** Lesson-level MESH attachments have no assignment owner unless the source
 * supplies an explicit edge. Do not attach every file to every sibling task.
 * @see ../docs/product/day-page.md#multiple-assignments */
export function teacherFilesForEntry(assignment, entry, entries) {
  const files = assignment.teacherFiles ?? []
  const actionable = entries.filter((candidate) => !/^файл здесь\.?$/i.test(String(candidate.description ?? '').trim()))
  if (actionable.length <= 1) return files
  const ownIds = new Set((entry.teacherFileIds ?? []).map(String))
  return files.filter((file) => ownIds.has(String(file.id))
    || String(file.homeworkEntryId ?? '') === String(entry.id)
    || (file.homeworkEntryIds ?? []).map(String).includes(String(entry.id)))
}
