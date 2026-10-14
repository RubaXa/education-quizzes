import type { DayUpload, DayWorkReview } from './dayStore'

export type ReviewTone = 'success' | 'partial' | 'error' | 'neutral'
export type ProblemCardState = { label: string; tone: 'ready' | 'uploading' | 'waiting' | 'processing' | 'verified' | 'partial' | 'error' }
export type ArtifactAvatarState = 'uploading' | 'waiting' | 'processing' | 'reviewed' | 'failed' | 'paused'

/** One file state drives the same avatar on the day page and in the weekend slot. */
export function artifactAvatarState(upload: DayUpload, review?: DayWorkReview, now = Date.now()): ArtifactAvatarState {
  if (upload.status === 'reviewed') return 'reviewed'
  if (upload.status === 'upload-error') return 'failed'
  if (upload.status !== 'pending') return 'uploading'
  const processing = activeProcessing(review, [upload])
  if (!processing) return 'waiting'
  if (processing.phase === 'paused' || processingIsStale(processing, now)) return 'paused'
  return 'processing'
}

export function localArtifactAvatarState(state: 'uploading' | 'saved' | 'failed' | 'deleting'): ArtifactAvatarState {
  return state === 'failed' ? 'failed' : state === 'saved' ? 'waiting' : 'uploading'
}

export function artifactAvatarLabel(state: ArtifactAvatarState): string {
  return ({ uploading: 'Передаём фото', waiting: 'Ждёт проверки', processing: 'Идёт разбор', reviewed: 'Проверено', failed: 'Не загрузилось', paused: 'Проверка задержана' })[state]
}

export function processingIsStale(processing: NonNullable<DayWorkReview['processing']>, now: number): boolean {
  return now - (timestampMillis(processing.updatedAt) ?? now) > 30 * 60 * 1000
}

/** A file's progress and a solution's result remain separate Firestore facts. */
export function problemCardState(uploads: DayUpload[], review?: DayWorkReview, uploading = false, now = Date.now(), accepted = false): ProblemCardState {
  if (uploading) return { label: 'Фото загружается', tone: 'uploading' }
  if (uploads.some((upload) => artifactAvatarState(upload, review, now) === 'uploading')) return { label: 'Фото загружается', tone: 'uploading' }
  if (uploads.some((upload) => upload.status === 'pending')) {
    const processing = activeProcessing(review, uploads)
    if (uploads.some((upload) => artifactAvatarState(upload, review, now) === 'processing')) return { label: processing?.label || 'Проверяем работу', tone: 'processing' }
    return { label: uploads.some((upload) => artifactAvatarState(upload, review, now) === 'paused') ? 'Фото получено · проверка задержана' : 'Фото получено · ждёт проверки', tone: 'waiting' }
  }
  if (accepted) return { label: 'Засчитано родителем · ход неполон', tone: 'verified' }
  if (review?.status === 'verified') return { label: reviewHeadline(review), tone: 'verified' }
  if (review?.status === 'partial') return { label: reviewHeadline(review), tone: 'partial' }
  if (review?.status === 'needs-fix') return { label: reviewHeadline(review), tone: 'error' }
  if (review?.assessmentBasis?.outcome === 'unresolved') return { label: reviewHeadline(review), tone: 'waiting' }
  if (review?.status === 'cannot-assess') return { label: 'Не удалось проверить', tone: 'waiting' }
  return uploads.length ? { label: 'Фото сохранено', tone: 'waiting' } : { label: 'Не начато', tone: 'ready' }
}

/** The compact heading retains the full state as its accessible label. */
export function compactProblemCardLabel(state: ProblemCardState): string {
  if (state.tone === 'ready') return 'Не начато'
  if (state.tone === 'uploading') return 'Загрузка'
  if (state.tone === 'processing') return 'Проверяем'
  if (state.tone === 'verified') return state.label.startsWith('Засчитано родителем') ? 'Засчитано' : 'Проверено'
  if (state.tone === 'partial') return 'Частично'
  if (state.tone === 'error') return 'Исправить'
  return state.label.includes('ждёт проверки') || state.label.includes('задержана') ? 'Ждёт проверки' : 'Неясно'
}

/** @see ../../docs/product/day-page.md#homework-review */
export function reviewTone(review: DayWorkReview): ReviewTone {
  if (review.assessmentBasis?.outcome === 'unresolved') return 'neutral'
  const items = review.items ?? []
  if (!items.length) return 'neutral'
  if (review.status === 'verified' && items.every((item) => item.status === 'correct')) return 'success'
  if (items.some((item) => item.status === 'correct' || item.status === 'partial')) return 'partial'
  if (review.status === 'needs-fix' && items.every((item) => item.status === 'incorrect')) return 'error'
  return 'neutral'
}

/** @see ../../docs/product/day-page.md#homework-review */
export function reviewHeadline(review: DayWorkReview): string {
  if (review.assessmentBasis?.outcome === 'unresolved') return workCoverageComplete(review) ? 'Работа сдана · критерий оценки неясен'
    : review.nextStep && review.items?.some((item) => item.status === 'cannot-assess') ? 'Часть задания не подтверждена'
      : 'Работа разобрана · критерий неясен'
  if (review.studentFeedback?.title) return review.studentFeedback.title
  if (review.mathReasoning) {
    const { answer, argument } = review.mathReasoning
    if (answer === 'correct' && argument === 'not-required') return 'Ответ верен'
    if (answer === 'correct' && argument === 'sufficient') return 'Ответ и ход подтверждены'
    if (answer === 'correct' && argument === 'unreadable') return 'Ответ верен · ход не читается'
    if (answer === 'correct') return 'Ответ верен · покажи ход'
    if (answer === 'incorrect' && argument === 'sufficient') return 'Ход виден · проверь ответ'
    if (answer === 'incorrect') return 'Работа проверена · нужна правка'
    return 'Решение пока не подтверждено'
  }
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

/** A reviewed submission may cover every assigned action while its quality criterion is unresolved. @see ../../docs/product/review-criteria-provenance.md#work-coverage */
export function workCoverageComplete(review?: DayWorkReview): boolean {
  const checkedAt = timestampMillis(review?.checkedAt)
  return review?.status === 'cannot-assess' && review.assessmentBasis?.outcome === 'unresolved'
    && review.workCoverage?.state === 'complete' && checkedAt !== null
    && timestampMillis(review.workCoverage.reviewCheckedAt) === checkedAt
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
