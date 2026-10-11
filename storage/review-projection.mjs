/** Only this projection may be stored under learner-readable dayProgress.
 * @see ../docs/product/adaptive-problem-card.md#показ-ученику
 */
export function studentReviewProjection(review) {
  if (!review || typeof review !== 'object') return review
  const prune = (value) => Array.isArray(value) ? value.map(prune)
    : value && typeof value === 'object' && !(typeof value.toDate === 'function')
      ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, prune(item)])) : value
  const basis = review.assessmentBasis
  const dispute = basis?.disputedRequirements?.map((item) => ({ id: item.id, action: item.action }))
  const history = review.history?.map((entry) => ({
    status: entry.status, checkedAt: entry.checkedAt,
    ...(entry.studentFeedback?.title ? { studentFeedback: { title: entry.studentFeedback.title } } : {}),
  }))
  return prune({
    date: review.date, taskId: review.taskId, planRevision: review.planRevision,
    uploadIds: review.uploadIds, status: review.status, checkedAt: review.checkedAt,
    ...(review.correctedAt ? { correctedAt: review.correctedAt } : {}),
    ...(review.studentFeedback ? { studentFeedback: {
      title: review.studentFeedback.title, confirmed: review.studentFeedback.confirmed,
      focus: review.studentFeedback.focus, question: review.studentFeedback.question,
      ...(review.studentFeedback.anchor ? { anchor: { uploadId: review.studentFeedback.anchor.uploadId,
        location: review.studentFeedback.anchor.location } } : {}),
    } } : {}),
    ...(review.mathReasoning ? { mathReasoning: { answer: review.mathReasoning.answer, argument: review.mathReasoning.argument } } : {}),
    ...(basis ? { assessmentBasis: {
      outcome: basis.outcome,
      ...(basis.disputedRequirementIds ? { disputedRequirementIds: basis.disputedRequirementIds } : {}),
      ...(dispute ? { disputedRequirements: dispute } : {}),
    } } : {}),
    ...(review.workCoverage ? { workCoverage: {
      state: review.workCoverage.state,
      note: review.workCoverage.state === 'complete' ? 'Все назначенные части предъявлены.' : 'Объём работы уточняется.',
      sourceRef: review.workCoverage.sourceRef,
      reviewCheckedAt: review.workCoverage.reviewCheckedAt,
      recordedAt: review.workCoverage.recordedAt,
    } } : {}),
    ...(review.items ? { items: review.items.map((item) => ({ label: item.label, status: item.status })) } : {}),
    ...(history ? { history } : {}),
    ...(review.processing ? { processing: review.processing } : {}),
  })
}
