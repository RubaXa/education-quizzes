/** @see ../docs/decisions/accepted-help-closure-2026-10-25.md */
/** @see ../docs/modules/synchronization/education-pipeline.md#sync-inbox */
const millis = value => {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  const seconds = value?.seconds ?? value?._seconds
  const nanos = value?.nanoseconds ?? value?._nanoseconds ?? 0
  return Number.isFinite(seconds) ? seconds * 1000 + nanos / 1e6 : null
}

/** A family closure is not a tutor reply or evidence of independent mastery. */
export function helpRequestResolution({ taskId, request, review, decisions = [] }) {
  const requestedAt = millis(request?.requestedAt), checkedAt = millis(review?.checkedAt)
  if (!Number.isFinite(requestedAt) || !Number.isFinite(checkedAt)) return null
  const latest = decisions.filter(event => event.taskId === taskId
    && ['accept', 'reopen'].includes(event.action)
    && millis(event.reviewCheckedAt) === checkedAt && Number.isFinite(millis(event.decidedAt)))
    .sort((a,b) => millis(b.decidedAt)-millis(a.decidedAt) || String(b.id).localeCompare(String(a.id)))[0]
  if (latest?.action === 'reopen' && millis(latest.decidedAt) > requestedAt) return null
  if (review.status === 'verified' && checkedAt > requestedAt) return 'later-student-work-verified'
  return latest?.action === 'accept' && latest.actorPersonId && millis(latest.decidedAt) > requestedAt
    ? 'later-family-acceptance' : null
}
