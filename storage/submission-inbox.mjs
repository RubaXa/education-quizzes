/** @see ../docs/product/storage-privacy.md#review-queue */
function millis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Resolve a pending file to its private owner and the assignment visible on the
 * day page. Never infer an assignment from filename, subject or disk directory.
 * @see ../docs/product/storage-privacy.md#review-queue
 */
export function resolveSubmission({ owner, page, childName, uploadId, upload }) {
  const contextValid = page?.kind === 'student' && page.date === owner.date
  const subject = contextValid ? page.subjects?.find((item) => item.tasks?.some((task) => task.id === upload.taskId)) : null
  const task = subject?.tasks.find((item) => item.id === upload.taskId)
  const linked = Boolean(contextValid && page.taskIds?.includes(upload.taskId) && task)
  const createdAt = millis(upload.createdAt)
  const changedAfterUpload = Boolean(linked && createdAt != null && page.changes?.some((change) =>
    change.changed?.includes(upload.taskId) && millis(change.at) > createdAt))
  const fileState = upload.storage?.state === 'stored' && upload.storage.path
    ? 'on-disk' : upload.dataUrl ? 'awaiting-disk' : 'missing-file'
  return {
    familyId: owner.familyId,
    childId: owner.childId,
    childName: childName || 'Имя ребёнка не указано',
    dayDate: owner.date,
    dueDate: page?.targetDate ?? owner.targetDate,
    uploadId,
    taskId: upload.taskId,
    reviewStatus: upload.status,
    uploadedAt: createdAt == null ? null : new Date(createdAt).toISOString(),
    fileState,
    diskPath: fileState === 'on-disk' ? upload.storage.path : null,
    subject: linked ? subject.name : null,
    taskTitle: linked ? task.title : null,
    assignmentText: linked ? task.meshText ?? task.detail : null,
    expectedPhoto: linked ? task.submission?.photo ?? task.submission?.description ?? null : null,
    planRevision: linked ? page.planRevision ?? null : null,
    conditionChangedAfterUpload: changedAfterUpload,
    resolution: linked ? 'linked' : 'needs-manual-link',
  }
}
