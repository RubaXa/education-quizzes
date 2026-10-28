/** @see ../../../docs/decisions/olympiad-domain-ldd-2026-10-27.md */
/** @see ../../../docs/product/olympiad-preparation.md */
/** Domain transitions for written work; persistence and authorization belong to the caller.
 * @see ../../../docs/modules/assessments/olympiad-preparation.md#модель-урока-и-свидетельств */
export type WrittenResult = 'verified' | 'partial' | 'needs-fix' | 'unreadable'
export type WrittenPhoto = { id: string }
export type WrittenReview = { id: string; photoIds: string[]; result?: WrittenResult }
export type WrittenAttempt = { id: string; photos: WrittenPhoto[]; reviews: WrittenReview[] }
export type WrittenPractice = { attempts: WrittenAttempt[] }

/** Keep the exact photos examined by each review; a late photo is not silently evaluated. */
export function addPhoto(state: WrittenPractice, attemptId: string, photoId: string): WrittenPractice {
  if (!attemptId || !photoId) throw new Error('Missing attempt or photo identifier')
  const existing = state.attempts.find(attempt => attempt.photos.some(photo => photo.id === photoId))
  if (existing) {
    if (existing.id !== attemptId) throw new Error('Photo identifier belongs to another attempt')
    return state
  }
  const last = state.attempts.at(-1)
  const latest = last?.reviews.at(-1)
  const outstanding = last?.photos.some(photo => !last.reviews.some(review => review.result && review.photoIds.includes(photo.id))) ?? false
  const beginsAttempt = !last || Boolean(latest?.result && latest.result !== 'unreadable' && !outstanding)
  if (beginsAttempt) {
    if (state.attempts.some(attempt => attempt.id === attemptId)) throw new Error('Attempt identifier already exists')
    return { attempts: [...state.attempts, { id: attemptId, photos: [{ id: photoId }], reviews: [] }] }
  }
  if (last.id !== attemptId) throw new Error('Photo must belong to the active attempt')
  return { attempts: [...state.attempts.slice(0, -1), { ...last, photos: [...last.photos, { id: photoId }] }] }
}

export function startReview(state: WrittenPractice, attemptId: string, reviewId: string): WrittenPractice {
  const last = state.attempts.at(-1)
  if (!last || last.id !== attemptId || !reviewId) throw new Error('Attempt unavailable')
  if (last.reviews.some(review => review.id === reviewId)) return state
  if (state.attempts.some(attempt => attempt.reviews.some(review => review.id === reviewId))) throw new Error('Review identifier already exists')
  if (last.reviews.some(review => review.result === undefined)) throw new Error('Review already in progress')
  if (!last.photos.length) throw new Error('Review requires a photo')
  const review: WrittenReview = { id: reviewId, photoIds: last.photos.map(photo => photo.id) }
  return { attempts: [...state.attempts.slice(0, -1), { ...last, reviews: [...last.reviews, review] }] }
}

export function completeReview(state: WrittenPractice, attemptId: string, reviewId: string, result: WrittenResult): WrittenPractice {
  if (!['verified', 'partial', 'needs-fix', 'unreadable'].includes(result)) throw new Error('Invalid result')
  const last = state.attempts.at(-1)
  const review = last?.reviews.find(item => item.id === reviewId)
  if (!last || last.id !== attemptId || !review) throw new Error('Review unavailable')
  if (review.result) {
    if (review.result === result) return state
    throw new Error('Review already completed')
  }
  return { attempts: [...state.attempts.slice(0, -1), { ...last, reviews: last.reviews.map(item => item.id === reviewId ? { ...item, result } : item) }] }
}

/** An unreadable photo never replaces the previous substantive result. */
export function latestResult(state: WrittenPractice): Exclude<WrittenResult, 'unreadable'> | undefined {
  for (const attempt of [...state.attempts].reverse()) for (const review of [...attempt.reviews].reverse()) {
    if (review.result && review.result !== 'unreadable') return review.result
  }
}
