import { describe, expect, it } from 'vitest'
import type { DayWorkReview } from './dayStore'
import { artifactAvatarLabel, compactProblemCardLabel, firstPendingUploadReceivedAt, localArtifactAvatarState,
  problemCardState, reviewHeadline, reviewTone, showSeparateWorkReview } from './reviewPresentation'

function review(status: DayWorkReview['status'], items: Array<'correct' | 'partial' | 'incorrect' | 'cannot-assess'>): DayWorkReview {
  return { id: 'test', taskId: 'test', status, items: items.map((item, index) => ({ label: `${index + 1}`, status: item, observed: 'ответ', note: 'пояснение' })) }
}

describe('collapsed homework review', () => {
  it('does not treat locally saved bytes as received by the server', () => {
    expect(artifactAvatarLabel(localArtifactAvatarState('saved'))).toBe('Передаём фото')
    expect(artifactAvatarLabel(localArtifactAvatarState('uploading'))).toBe('Передаём фото')
    expect(localArtifactAvatarState('failed')).toBe('failed')
  })
  it('starts pending wait from the earliest confirmed storage time and leaves legacy time unknown', () => {
    const upload = (id: string, createdAt: number, syncedAt?: number) => ({
      id, taskId: 'task', status: 'pending', createdAt: { toMillis: () => createdAt },
      ...(syncedAt === undefined ? {} : { storage: { syncedAt: { toMillis: () => syncedAt } } }),
    }) as unknown as import('./dayStore').DayUpload
    const uploads = [upload('later', 1_000, 20_000), upload('earlier-received', 2_000, 10_000)]
    expect(firstPendingUploadReceivedAt(uploads)).toBe(uploads[1].storage!.syncedAt)
    expect(firstPendingUploadReceivedAt([upload('legacy', 1_000)])).toBeUndefined()
  })
  it('keeps one parent route for a reviewed written task, while preserving learner feedback and parent decisions', () => {
    expect(showSeparateWorkReview(true, 'learning-route')).toBe(false)
    expect(showSeparateWorkReview(false, 'learning-route')).toBe(true)
    expect(showSeparateWorkReview(true, 'math-route')).toBe(true)
    expect(showSeparateWorkReview(true, 'learning-route', true)).toBe(true)
    expect(showSeparateWorkReview(true, 'learning-route', false, true)).toBe(true)
  })
  it('shows a short truthful status before any work is uploaded', () => {
    const state = problemCardState([])
    expect(state).toEqual({ label: 'Не начато', tone: 'ready' })
    expect(compactProblemCardLabel(state)).toBe('')
    expect(compactProblemCardLabel({ label: 'Ответ и ход подтверждены', tone: 'verified' })).toBe('Проверено')
    expect(compactProblemCardLabel({ label: 'Фото получено · ждёт проверки', tone: 'waiting' })).toBe('Ждёт проверки')
  })
  it('shows green only when the entire work is verified', () => {
    const done = review('verified', ['correct', 'correct'])
    expect(reviewTone(done)).toBe('success')
    expect(reviewHeadline(done)).toBe('Всё верно · 2 из 2')
    expect(reviewTone(review('partial', ['correct', 'correct']))).toBe('partial')
    expect(reviewHeadline(review('partial', ['correct', 'correct']))).toBe('2 из 2 верно · работа не завершена')
  })

  it('distinguishes mixed and wholly incorrect results', () => {
    const mixed = review('needs-fix', ['correct', 'partial', 'incorrect'])
    expect(reviewTone(mixed)).toBe('partial')
    expect(reviewHeadline(mixed)).toBe('1 из 3 верно · 1 частично')
    const wrong = review('needs-fix', ['incorrect', 'incorrect'])
    expect(reviewTone(wrong)).toBe('error')
    expect(reviewHeadline(wrong)).toBe('0 из 2 верно')
  })

  it('keeps unassessable work neutral', () => {
    expect(reviewTone(review('cannot-assess', ['cannot-assess']))).toBe('neutral')
  })

  it('distinguishes an off-frame answer from an unclear criterion', () => {
    const missing = { ...review('cannot-assess', ['partial', 'cannot-assess']),
      assessmentBasis: { outcome: 'unresolved', unresolvedReason: 'missing-evidence' } } as DayWorkReview
    expect(reviewHeadline(missing)).toBe('Часть работы не видна на фото')
    expect(problemCardState([], missing).label).toBe('Часть работы не видна на фото')
    const criterion = { ...missing, assessmentBasis: { outcome: 'unresolved', unresolvedReason: 'criterion-unclear' } } as DayWorkReview
    expect(reviewHeadline(criterion)).toBe('Работа разобрана · критерий неясен')
  })
})
