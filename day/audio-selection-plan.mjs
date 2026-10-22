/** Private per-day audio plan guards. Evidence is never copied to public tasks.
 * @see ../docs/modules/materials/audio-library.md#assignment
 * @see ../docs/modules/materials/material-clarification.md#модель
 * @see ../docs/decisions/audio-library-2026-10-22.md#было--стало */
export function sourceMaterialAudioTaskIds(source, selections) {
  if (!selections || typeof selections !== 'object' || Array.isArray(selections)) {
    throw new Error('audioSelections должен быть закрытым объектом по taskId.')
  }
  const taskIds = new Set((source.subjects ?? []).flatMap((subject) => (subject.tasks ?? []).map((task) => task.id)))
  const materialIds = []
  for (const [taskId, items] of Object.entries(selections)) {
    if (!/^[a-z0-9-]+$/.test(taskId) || !taskIds.has(taskId) || !Array.isArray(items) || !items.length) {
      throw new Error(`Явная аудиопривязка ${taskId} должна быть непустым списком для существующего задания.`)
    }
    if (items.some((item) => item?.evidence?.kind === 'source-material')) materialIds.push(taskId)
  }
  return materialIds
}

export function clarificationAudioPageError({ owner, page, date, targetDate, familyId, childId }) {
  if (owner?.familyId !== familyId || owner?.childId !== childId || owner?.date !== date
    || owner?.targetDate !== targetDate || page?.kind !== 'student' || page?.familyId !== familyId
    || page?.childId !== childId || page?.date !== date || page?.targetDate !== targetDate
    || !Number.isInteger(page?.planRevision) || page.planRevision < 1) {
    return 'Нельзя использовать уточнение аудио без совпадающей страницы этого ребёнка и даты.'
  }
  return null
}
