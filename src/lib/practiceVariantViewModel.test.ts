import { describe, expect, it } from 'vitest'
import { practiceVariantView } from './practiceVariantViewModel'

describe('collapsed practice variant status', () => {
  const problems = [7, 8].map(number => ({ id: `p${number}`, number, title: `№${number}`, detail: '', source: 'Лист' }))
  it('propagates verified and correction states regardless of requirement', () => {
    const view = practiceVariantView(problems, [
      { id: 'r7', taskId: 'p7', status: 'verified', uploadIds: ['photo7'] },
      { id: 'r8', taskId: 'p8', status: 'needs-fix', uploadIds: ['photo8'] },
    ], [
      { id: 'student:photo7', taskId: 'p7', status: 'reviewed' },
      { id: 'student:photo8', taskId: 'p8', status: 'reviewed' },
    ])
    expect(view).toMatchObject({ verified: 1, needsFix: 1, status: 'needs-fix', label: '1 из 2 · Исправить' })
    expect(view.label).not.toMatch(/По желанию|Обязательно|Опционально/)
  })
  it('does not treat an optional or untouched variant as completed', () => {
    expect(practiceVariantView(problems, []).status).toBe('not-started')
  })
  it('does not show completion while a newer photo is pending or evidence is not ready', () => {
    const reviews = [{ id: 'r7', taskId: 'p7', status: 'verified' as const, uploadIds: ['photo7'] }]
    const uploads = [{ id: 'student:photo7', taskId: 'p7', status: 'reviewed' as const }, { id: 'student:new', taskId: 'p7', status: 'pending' as const }]
    expect(practiceVariantView([problems[0]], reviews, uploads).status).toBe('in-progress')
    expect(practiceVariantView([problems[0]], reviews, uploads, [], 0, false).status).toBe('in-progress')
  })
  it('counts a parent acceptance only with its matching reviewed photo', () => {
    const review = { id: 'student:p7', taskId: 'p7', status: 'partial', checkedAt: { seconds: 100, nanoseconds: 0 },
      uploadIds: ['photo7'], mathReasoning: { answer: 'correct', argument: 'incomplete' },
      assessmentBasis: { outcome: 'not-met' } } as Parameters<typeof practiceVariantView>[1][number]
    const decisions = [{ id: 'student:decision', taskId: 'p7', action: 'accept',
      reviewCheckedAt: { seconds: 100, nanoseconds: 0 }, decidedAt: { seconds: 101, nanoseconds: 0 } }] as Parameters<typeof practiceVariantView>[3]
    expect(practiceVariantView([problems[0]], [review], [], decisions).accepted).toBe(0)
    expect(practiceVariantView([problems[0]], [review], [
      { id: 'student:photo7', taskId: 'p7', status: 'reviewed' },
    ], decisions)).toMatchObject({ accepted: 1, verified: 0, completed: 1, status: 'accepted', label: 'Засчитано' })
  })
})
