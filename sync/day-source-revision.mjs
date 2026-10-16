import { createHash } from 'node:crypto'

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}

/** A stable, date-specific revision of the MESH lesson and assignment source.
 * It deliberately excludes fetch time and period-wide marks.
 * @see ../docs/modules/synchronization/global-sync.md#reconciliation
 */
export function daySourceRevision(snapshot) {
  if (!snapshot?.complete || !Array.isArray(snapshot.schedule) || !Array.isArray(snapshot.assignments)) {
    throw new Error('Для ревизии дня нужен полный снимок МЭШ.')
  }
  const schedule = snapshot.schedule.map((item) => ({
    id: item.id, start_at: item.start_at, finish_at: item.finish_at,
    subject_id: item.subject_id, subject_name: item.subject_name,
    cancelled: item.cancelled, replaced: item.replaced, homework: item.homework, marks: item.marks,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const assignments = snapshot.assignments.map((item) => ({
    sourceItemId: item.sourceItemId, lessonDate: item.lessonDate,
    descriptions: item.descriptions, materialCounts: item.materialCounts,
    homeworkEntries: item.homeworkEntries, teacherFiles: item.teacherFiles, detailStatus: item.detailStatus,
  })).sort((a, b) => String(a.sourceItemId).localeCompare(String(b.sourceItemId)))
  return createHash('sha256').update(JSON.stringify(canonical({ schedule, assignments }))).digest('hex')
}
