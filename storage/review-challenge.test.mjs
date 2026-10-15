import { describe, expect, it } from 'vitest'
import { reviewChallengeErrors } from './review-challenge.mjs'

const a = 'a'.repeat(24)
const b = 'b'.repeat(24)
const task = { kind: 'written', meshText: 'Упр. 218, 223 (выписать только средства выразительности).' }
const review = {
  status: 'partial', uploadIds: [a, b], challengeReview: {
    version: 1,
    initialConcern: 'На первом проходе показалось, что переписаны целые предложения.',
    reopenedUploadIds: [a, b],
    sourceBoundary: { meshText: task.meshText, otherSource: 'Семейный учебник, № 218 и № 223, стр. 112–115.' },
    regions: [{ uploadId: a, location: 'Раздел «Домашнее задание», строка № 218', observed: 'Выписаны отдельные сравнения.', legibility: 'clear' }],
    creditableAlternative: 'Видимый перечень может быть уже правильной выпиской, а не переписанным текстом.',
    resolution: 'confirmed-mismatch',
    reason: 'После повторного чтения видимый участок явно не соответствует назначенному действию.',
  },
}

describe('written-work challenge gate', () => {
  it('requires a second pass before a negative written review', () => {
    expect(reviewChallengeErrors({ ...review, challengeReview: undefined }, task)).not.toEqual([])
    expect(reviewChallengeErrors(review, task)).toEqual([])
  })
  it('requires every original photo and the exact teacher assignment', () => {
    expect(reviewChallengeErrors({ ...review, challengeReview: { ...review.challengeReview, reopenedUploadIds: [a] } }, task)[0]).toMatch(/все исходные фото/)
    expect(reviewChallengeErrors({ ...review, challengeReview: { ...review.challengeReview, sourceBoundary: { ...review.challengeReview.sourceBoundary, meshText: 'Другой текст' } } }, task)[0]).toMatch(/дословно/)
  })
  it('does not turn an unreadable region into a proved error', () => {
    const challengeReview = { ...review.challengeReview, regions: [{ ...review.challengeReview.regions[0], legibility: 'unreadable' }] }
    expect(reviewChallengeErrors({ ...review, challengeReview }, task)[0]).toMatch(/не доказывает/)
  })
  it('requires uncertainty rather than a negative finding when the written answer cannot be seen', () => {
    const uncertain = { ...review, status: 'cannot-assess', challengeReview: { ...review.challengeReview, resolution: 'uncertain' } }
    expect(reviewChallengeErrors(uncertain, task)).toEqual([])
    expect(reviewChallengeErrors({ ...uncertain, challengeReview: review.challengeReview }, task)[0]).toMatch(/противоречит/)
  })
  it('allows a clean verified answer without extra work, and records a cleared concern when supplied', () => {
    expect(reviewChallengeErrors({ status: 'verified', uploadIds: [a, b] }, task)).toEqual([])
    const cleared = { ...review, status: 'verified', challengeReview: { ...review.challengeReview, resolution: 'cleared' } }
    expect(reviewChallengeErrors(cleared, task)).toEqual([])
  })
  it('leaves a platform receipt outside the written-work gate', () => {
    expect(reviewChallengeErrors({ ...review, challengeReview: undefined }, { kind: 'platform' })).toEqual([])
  })
})
