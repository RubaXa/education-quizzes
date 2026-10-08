import { describe, expect, it } from 'vitest'
import type { DayWorkReview } from './dayStore'
import { reviewHeadline, reviewTone } from './reviewPresentation'

function review(status: DayWorkReview['status'], items: Array<'correct' | 'partial' | 'incorrect' | 'cannot-assess'>): DayWorkReview {
  return { id: 'test', taskId: 'test', status, items: items.map((item, index) => ({ label: `${index + 1}`, status: item, observed: 'ответ', note: 'пояснение' })) }
}

describe('collapsed homework review', () => {
  it('shows green only when the entire work is verified', () => {
    const done = review('verified', ['correct', 'correct'])
    expect(reviewTone(done)).toBe('success')
    expect(reviewHeadline(done)).toBe('Всё верно · 2 из 2')
    expect(reviewTone(review('partial', ['correct', 'correct']))).toBe('partial')
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
})
