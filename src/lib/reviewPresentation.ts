import type { DayUpload, DayWorkReview } from './dayStore'

export type ReviewTone = 'success' | 'partial' | 'error' | 'neutral'

/** @see ../../docs/product/day-page.md#homework-review */
export function reviewTone(review: DayWorkReview): ReviewTone {
  const items = review.items ?? []
  if (!items.length) return 'neutral'
  if (review.status === 'verified' && items.every((item) => item.status === 'correct')) return 'success'
  if (items.some((item) => item.status === 'correct' || item.status === 'partial')) return 'partial'
  if (review.status === 'needs-fix' && items.every((item) => item.status === 'incorrect')) return 'error'
  return 'neutral'
}

/** @see ../../docs/product/day-page.md#homework-review */
export function reviewHeadline(review: DayWorkReview): string {
  const items = review.items ?? []
  const correct = items.filter((item) => item.status === 'correct').length
  if (!items.length) return 'Проверка работы'
  if (review.status === 'cannot-assess' && items.every((item) => item.status === 'cannot-assess')) return 'Не удалось проверить'
  if (review.status === 'verified' && correct === items.length) return `Всё верно · ${correct} из ${items.length}`
  const partial = items.filter((item) => item.status === 'partial').length
  if (review.status === 'partial' && correct === items.length) return `${correct} из ${items.length} верно · работа не завершена`
  return `${correct} из ${items.length} верно${partial ? ` · ${partial} частично` : ''}`
}

export function timestampMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const timestamp = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
  const seconds = timestamp.seconds ?? timestamp._seconds
  return typeof seconds === 'number' ? seconds * 1000 : null
}

export function elapsedLabel(startedAt: unknown, now: number): string {
  const started = timestampMillis(startedAt)
  if (started === null) return 'Время уточняется'
  const seconds = Math.max(0, Math.floor((now - started) / 1000))
  if (seconds < 60) return `${seconds} с`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes} мин ${String(seconds % 60).padStart(2, '0')} с` : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

export function activeProcessing(review: DayWorkReview | undefined, uploads: DayUpload[]) {
  const processing = review?.processing
  if (!processing) return null
  const pending = new Set(uploads.filter((upload) => upload.status === 'pending').map((upload) => upload.id.split(':').at(-1)))
  return processing.uploadIds.some((id) => pending.has(id)) ? processing : null
}
