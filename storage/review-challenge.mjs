/** A second, evidence-led reading before a written-work concern can be published.
 * This validates traceability, not the truth of a human transcription.
 * @see ../docs/product/review-criteria-provenance.md#second-pass
 */
export function reviewChallengeErrors(review, task, { required = false } = {}) {
  if (task?.kind !== 'written' || !required && review.status === 'verified' && !review.challengeReview) return []
  const challenge = review.challengeReview
  if (!challenge || challenge.version !== 1 || typeof challenge.initialConcern !== 'string'
    || challenge.initialConcern.trim().length < 12) return ['Письменная работа с замечанием требует второго чтения: challengeReview.initialConcern.']
  const expectedUploads = [...new Set(review.uploadIds ?? [])].sort()
  const reopened = Array.isArray(challenge.reopenedUploadIds) ? [...new Set(challenge.reopenedUploadIds)].sort() : []
  if (!expectedUploads.length || JSON.stringify(reopened) !== JSON.stringify(expectedUploads)) {
    return ['На втором проходе нужно заново открыть все исходные фото этого номера.']
  }
  if (challenge.sourceBoundary?.meshText !== task.meshText
    || typeof challenge.sourceBoundary?.otherSource !== 'string'
    || challenge.sourceBoundary.otherSource.trim().length < 12) {
    return ['Второй проход должен дословно сверить МЭШ и отдельно назвать учебник, лист учителя или отсутствие источника.']
  }
  if (!Array.isArray(challenge.regions) || !challenge.regions.length
    || !challenge.regions.every((region) => expectedUploads.includes(region.uploadId)
      && typeof region.location === 'string' && region.location.trim().length >= 8
      && typeof region.observed === 'string' && region.observed.trim().length >= 8
      && ['clear', 'uncertain', 'unreadable'].includes(region.legibility))) {
    return ['Для спорного вывода нужен конкретный участок оригинала, видимая запись и уверенность чтения.']
  }
  if (typeof challenge.creditableAlternative !== 'string' || challenge.creditableAlternative.trim().length < 20
    || typeof challenge.reason !== 'string' || challenge.reason.trim().length < 20) {
    return ['Проверьте наиболее сильное толкование в пользу ученика и объясните итог второго прохода.']
  }
  const expectedResolution = review.status === 'cannot-assess' ? 'uncertain'
    : review.status === 'verified' ? 'cleared' : 'confirmed-mismatch'
  if (challenge.resolution !== expectedResolution) {
    return ['Итог второго прохода противоречит публикуемому статусу письменной работы.']
  }
  if (review.status !== 'verified' && challenge.regions.every((region) => region.legibility !== 'clear')
    && challenge.resolution === 'confirmed-mismatch') {
    return ['Нечёткая запись без другого ясного участка не доказывает ошибку ученика.']
  }
  return []
}
