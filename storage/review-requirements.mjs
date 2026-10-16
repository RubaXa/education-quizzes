/** Per-assigned-unit evidence contract. Text here is safe for learner display; private keys stay in source packs.
 * @see ../docs/modules/reviews/review-criteria-provenance.md#requirement-trace */
export function validateRequirementChecks(review) {
  if (review.requirementChecks === undefined) return
  const checks = review.requirementChecks
  const ids = review.checkableStageIds ?? []
  if (!Array.isArray(checks) || !checks.length || checks.length !== ids.length
    || JSON.stringify(checks.map((check) => check.id)) !== JSON.stringify(ids)) {
    throw new Error('Каждый обязательный пункт МЭШ должен иметь отдельную сверку в том же порядке.')
  }
  const statusMap = { correct: 'confirmed', incorrect: 'not-met', partial: 'partial', 'cannot-assess': 'unknown' }
  for (const check of checks) {
    const item = review.items.find((entry) => entry.stageId === check.id)
    if (!item || check.result !== statusMap[item.status]
      || !['visible', 'outside-frame', 'unreadable', 'not-sent'].includes(check.evidence?.state)
      || check.result === 'confirmed' && check.evidence.state !== 'visible'
      || check.result === 'unknown' && check.evidence.state === 'visible'
      || !review.uploadIds.includes(check.evidence.uploadId)
      || ![check.action, check.meshExcerpt, check.materialExcerpt, check.evidence.observation, check.explanation].every((value) => typeof value === 'string' && value.trim().length >= 8 && value.length <= 350)
      || !review.assessmentBasis?.sources?.some((source) => source.kind === 'mesh' && source.role === 'requirement' && source.excerpt === check.meshExcerpt)
      || !review.assessmentBasis?.sources?.some((source) => source.kind === 'textbook' && source.role === 'context' && source.excerpt === check.materialExcerpt)) {
      throw new Error(`Сверка ${check.id} противоречит источникам, фото или результату пункта.`)
    }
  }
}

export function requirementSummary(checks) {
  return { confirmed: checks.filter((check) => check.result === 'confirmed').length, total: checks.length }
}
