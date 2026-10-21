/**
 * @see ../docs/operations/recovery.md
 */
import { familyAssignmentErrors } from '../day/family-assignment.mjs'

/** Compare the current source projection with the last Firestore publication.
 * A fresh download alone must never clear an unpublished change.
 * @see ../docs/modules/synchronization/global-sync.md#reconciliation
 * @see ../docs/decisions/project-publication-audit-2026-10-21.md
 */
export function pendingPublicationDates(expected, published, dates) {
  const current = new Map((expected?.days ?? []).map((day) => [day.date, day]))
  const visible = new Map((published?.days ?? []).map((day) => [day.date, day]))
  const pending = []
  for (const date of dates) {
    const next = current.get(date)
    const prior = visible.get(date)
    const hadContent = Boolean(prior?.schedule?.length || prior?.homework?.length || prior?.homeworkDayToken)
    const hasContent = Boolean(next?.schedule?.length || next?.homework?.length || next?.homeworkDayToken)
    if (!hasContent && !hadContent) continue
    const reasons = []
    if (!next || !prior) reasons.push('day-not-published')
    else {
      if (!prior.sourceRevision || prior.sourceRevision !== next.sourceRevision) reasons.push('source-revision-differs')
      for (const field of ['schedule', 'homework', 'dayToken', 'homeworkDayToken']) {
        if (JSON.stringify(prior[field] ?? null) !== JSON.stringify(next[field] ?? null)) reasons.push(`${field}-differs`)
      }
    }
    if (next?.homework?.length && !next.homeworkDayToken) reasons.push('homework-page-missing')
    if (reasons.length) pending.push({ date, reasons })
  }
  return pending
}

/** Project the full dashboard index to the audited manifest window.
 * Publication diffing itself remains bounded by `dates`; this keeps historical
 * dashboard rows from being mistaken for missing expected audit rows.
 */
export function projectExpectedByDateToWindow(publication, dates) {
  if (!(publication?.expectedByDate instanceof Map) || !Array.isArray(dates)) {
    throw new Error('publication_audit_incomplete')
  }
  const window = new Set(dates)
  return { ...publication, expectedByDate: new Map([...publication.expectedByDate]
    .filter(([date]) => window.has(date))) }
}

/** A clean readback must belong to this exact owner and audience role. */
export function assertPublicationDashboardOwner(published, role, { familyId, childId }) {
  if (!published || published.kind !== role || published.familyId !== familyId || published.childId !== childId) {
    throw new Error(`publication_dashboard_owner_mismatch:${role}`)
  }
  return published
}

/** Build the actual day-enqueue worklist from the completed publication audit. */
export function publicationReconciliationCandidates(publication, changedDates = []) {
  if (!(publication?.expectedByDate instanceof Map) || !Array.isArray(publication.pending)) {
    throw new Error('publication_audit_incomplete')
  }
  const dates = new Set([...changedDates.map((item) => item.date), ...publication.pending.map((item) => item.date)])
  return [...dates].map((date) => ({ date, revision: publication.expectedByDate.get(date)?.sourceRevision ?? null }))
}

/** Keep the dashboard audit's family-origin overlay aligned with day publication.
 * MESH snapshots remain the source of MESH content; separately published family
 * tasks are included only when their owner, date, and explicit projection pass
 * the same validator as the day publisher.
 * @see ../docs/decisions/family-essay-assignment-2026-10-20.md
 */
export function validatedFamilyDashboardAssignments(assignments, { familyId, childId, dates }) {
  const dateSet = new Set(dates ?? [])
  return (assignments ?? []).flatMap((task) => {
    if (task?.publication !== 'active' || task.sourceSystem !== 'family' || task.dayProjectionVersion !== 1
      || !dateSet.has(task.dueDate)) return []
    const errors = familyAssignmentErrors(task, { familyId, childId, taskId: task.id })
    if (errors.length) throw new Error(`Family dashboard assignment invalid: ${task.id}: ${errors.join(' ')}`)
    return [task]
  })
}

/** Refresh only check times for already published, byte-equivalent day content.
 * Preserve inbox badges and every other field of the published index.
 * @see ../docs/modules/school-diary/dashboard.md#sync-freshness
 */
export function refreshedCalendarChecks(expected, published) {
  if (!Array.isArray(expected?.days) || !Array.isArray(published?.days)) return null
  const fresh = new Map(expected.days.map((day) => [day.date, day]))
  let changed = false
  const days = published.days.map((prior) => {
    const next = fresh.get(prior.date)
    if (!next?.checkedAt || !prior.sourceRevision || prior.sourceRevision !== next.sourceRevision) return prior
    for (const field of ['schedule', 'homework', 'dayToken', 'homeworkDayToken']) {
      if (JSON.stringify(prior[field] ?? null) !== JSON.stringify(next[field] ?? null)) return prior
    }
    const nextTime = Date.parse(next.checkedAt), priorTime = Date.parse(prior.checkedAt ?? '')
    if (!Number.isFinite(nextTime) || Number.isFinite(priorTime) && nextTime <= priorTime) return prior
    changed = true
    return { ...prior, checkedAt: next.checkedAt }
  })
  return changed ? days : null
}
