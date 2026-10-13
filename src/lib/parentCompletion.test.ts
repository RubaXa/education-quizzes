import { describe, expect, it } from 'vitest'
import type { DayWorkReview } from './dayStore'
import { stageCompletion, type ParentCompletionEvent } from './parentCompletion'

const at = (seconds: number) => ({ seconds, nanoseconds: 0 })
const review = {
  id: 'student-token:mesh-350396109', taskId: 'mesh-350396109', checkedAt: at(100), status: 'partial',
  checkableStageIds: ['educational', 'covering'],
  items: [
    { stageId: 'educational', label: 'Образовательная ткань', status: 'partial' },
    { stageId: 'covering', label: 'Покровная ткань', status: 'correct' },
  ],
} as DayWorkReview

describe('family review stage choices', () => {
  it('requires all checkable stages by default, then excludes a parent-optional stage from completion', () => {
    expect(stageCompletion(review, [])).toEqual({ required: 2, confirmed: 1, optional: 0, complete: false })
    const choice = { id: 'student-token:choice-1', taskId: review.taskId, stageId: 'educational',
      action: 'stage-optional', reviewCheckedAt: at(100), decidedAt: at(101) } as ParentCompletionEvent
    expect(stageCompletion(review, [choice])).toEqual({ required: 1, confirmed: 1, optional: 1, complete: true })
  })
  it('does not carry an old choice into a new review', () => {
    const old = { id: 'student-token:choice-1', taskId: review.taskId, stageId: 'educational',
      action: 'stage-optional', reviewCheckedAt: at(99), decidedAt: at(101) } as ParentCompletionEvent
    expect(stageCompletion(review, [old])?.complete).toBe(false)
  })
})
