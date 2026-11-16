/** @see ../docs/modules/assignments/README.md#readiness-and-handover */
export function learningGate({ prepared = false, requiredIds = [], reviews = [], pendingUploadIds = [], schoolDebt = false, delivered = false, readinessRequired = false, independentCheck = null } = {}) {
  const verifiedIds = requiredIds.filter(id => reviews.some(review => review.taskId === id && review.status === 'verified'))
  const missingIds = requiredIds.filter(id => !verifiedIds.includes(id))
  const completeWork = requiredIds.length > 0 && missingIds.length === 0 && pendingUploadIds.length === 0
  const ready = independentCheck?.reviewed === true && independentCheck?.independent === true && independentCheck?.passed === true
    && independentCheck?.coversAssignedScope === true && typeof independentCheck?.evidenceRef === 'string' && Boolean(independentCheck.evidenceRef.trim())
  return {
    preparation: prepared ? 'published' : 'not-confirmed',
    work: completeWork ? 'verified' : pendingUploadIds.length ? 'awaiting-review' : 'not-fully-confirmed',
    readiness: !readinessRequired ? 'not-required' : ready ? 'confirmed' : 'not-confirmed',
    deadlineRisk: readinessRequired && !ready ? 'independent-result-not-confirmed' : null,
    handover: delivered ? 'reported-delivered' : schoolDebt ? 'teacher-not-received' : 'unknown',
    verifiedIds, missingIds, preserveCredit: true,
    next: pendingUploadIds.length ? 'review-existing-uploads' : missingIds.length ? 'locate-existing-work-before-requesting-more'
      : schoolDebt && !delivered ? 'locate-and-hand-in-existing-work'
        : readinessRequired && !ready ? 'independent-check-and-deadline-risk' : 'preserve-verified-work',
    // These are pedagogical states, never an instruction to keep an operator lease open.
    operatorMayClosePublishedPreparation: prepared,
  }
}
