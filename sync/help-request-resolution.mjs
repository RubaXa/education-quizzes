/** @see ../docs/decisions/moving-preparation-window-2026-11-05.md */
/** @see ../docs/decisions/accepted-help-closure-2026-10-25.md */
/** @see ../docs/modules/synchronization/education-pipeline.md#sync-inbox */
const millis = value => {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  const seconds = value?.seconds ?? value?._seconds
  const nanos = value?.nanoseconds ?? value?._nanoseconds ?? 0
  return Number.isFinite(seconds) ? seconds * 1000 + nanos / 1e6 : null
}

/** A family closure is not a tutor reply or evidence of independent mastery. */
export function helpRequestResolution({ taskId, request, review, decisions = [], responses = [] }) {
  const requestedAt = millis(request?.requestedAt), checkedAt = millis(review?.checkedAt)
  if (!Number.isFinite(requestedAt)) return null
  const addressed = responses.some(response => response.taskId === taskId
    && response.stageId === 'help-response' && response.actorPersonId === 'education-operator'
    && /^[a-f0-9]{64}$/.test(response.sourceRequestEventId ?? '')
    && /^[a-f0-9]{64}$/.test(response.sourceArtifactId ?? '')
    && typeof response.text === 'string' && response.text.trim()
    && millis(response.createdAt) > requestedAt
    && !decisions.some(event => event.taskId === taskId && event.action === 'reopen'
      && millis(event.decidedAt) > millis(response.createdAt)))
  if (addressed) return 'later-addressed-tutor-response'
  if (!Number.isFinite(checkedAt)) return null
  const latest = decisions.filter(event => event.taskId === taskId
    && ['accept', 'reopen'].includes(event.action)
    && millis(event.reviewCheckedAt) === checkedAt && Number.isFinite(millis(event.decidedAt)))
    .sort((a,b) => millis(b.decidedAt)-millis(a.decidedAt) || String(b.id).localeCompare(String(a.id)))[0]
  if (latest?.action === 'reopen' && millis(latest.decidedAt) > requestedAt) return null
  if (review.status === 'verified' && checkedAt > requestedAt) return 'later-student-work-verified'
  return latest?.action === 'accept' && latest.actorPersonId && millis(latest.decidedAt) > requestedAt
    ? 'later-family-acceptance' : null
}
