/** @see ../docs/decisions/mesh-informational-entry-2026-10-21.md */
/** Conservative exact-text classification of non-action Mesh announcements.
 * @see ../docs/modules/synchronization/plan-generation.md#non-action-mesh-notice
 */
const HOLIDAY_NOTICE = /^всем\s+хороших\s+каникул[!.…]*$/iu
const HOLIDAY_NOTICE_REASON = 'Точная отдельная поздравительная запись МЭШ; в ней нет учебного действия.'
const NO_ASSIGNMENT_NOTICE = /^не\s+задано\.?$/iu
const NO_ASSIGNMENT_NOTICE_REASON = 'Точная отдельная отметка МЭШ «не задано»; в ней нет учебного действия.'

export function classifyMeshNotice(rawText, { hasTeacherFiles = false } = {}) {
  if (hasTeacherFiles || typeof rawText !== 'string') return null
  const normalized = rawText.trim().replace(/\s+/gu, ' ')
  if (HOLIDAY_NOTICE.test(normalized)) return { kind: 'notice', reason: HOLIDAY_NOTICE_REASON }
  if (NO_ASSIGNMENT_NOTICE.test(normalized)) return { kind: 'notice', reason: NO_ASSIGNMENT_NOTICE_REASON }
  return null
}

export function meshNoticeEntryErrors(entry, { subject, tasks = [], hasTeacherFiles = false } = {}) {
  const classified = classifyMeshNotice(entry?.rawText, { hasTeacherFiles })
  if (!classified || entry.kind !== 'notice' || entry.reason !== classified.reason || entry.targetTaskId != null
    || !/^mesh-\d+$/.test(entry.id ?? '') || !entry.subjectId || !subject || subject.id !== entry.subjectId
    || !subject.mesh?.includes(entry.rawText) || tasks.some((task) => task.id === entry.id)) {
    return [`Уведомление МЭШ ${entry?.id ?? ''} должно быть точной отдельной записью без целевого задания.`]
  }
  return []
}
