import { describe, expect, it } from 'vitest'
import type { DayTask, DayWorkReview } from './dayStore'
import { currentStageChoice, stageCompletion, variantRequired, type ParentCompletionEvent } from './parentCompletion'
import { lessonWorkItems } from './homeworkStatus'

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
  it('uses the live guide revision for the same checked work after a wording correction', () => {
    const original = { revision: 1, stages: [{ id: 'educational' }, { id: 'covering' }] }
    const corrected = { revision: 2, stages: [{ id: 'educational' }, { id: 'covering' }] }
    expect(currentStageChoice(review, original, review, corrected, 'educational')).toEqual({
      stageIndex: 0, guideRevision: 2, reviewCheckedAt: review.checkedAt,
    })
  })
  it('does not apply a choice to a newer photo review or changed stage structure', () => {
    const guide = { revision: 1, stages: [{ id: 'educational' }, { id: 'covering' }] }
    expect(() => currentStageChoice(review, guide, { ...review, checkedAt: at(101) }, guide, 'educational')).toThrow('Разбор изменился')
    expect(() => currentStageChoice(review, guide, review, { revision: 2, stages: [{ id: 'different' }, { id: 'covering' }] }, 'educational')).toThrow('Разбор изменился')
  })
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

describe('pre-work family practice choices', () => {
  it('requires each variant by default and applies only the latest choice for the same task', () => {
    const taskId = 'mesh-351641344', variantId = `${taskId}-v2`
    const optional = { id: 'student-token:a', taskId, variantId, action: 'variant-optional', decidedAt: at(102) } as ParentCompletionEvent
    const required = { id: 'student-token:b', taskId, variantId, action: 'variant-required', decidedAt: at(103) } as ParentCompletionEvent
    expect(variantRequired(taskId, variantId, [])).toBe(true)
    expect(variantRequired(taskId, variantId, [optional])).toBe(false)
    expect(variantRequired(taskId, variantId, [optional, required])).toBe(true)
    expect(variantRequired(taskId, `${taskId}-v1`, [optional])).toBe(true)
  })
  it('removes only the optional variant from the lesson to-do list while keeping the linked self-check', () => {
    const taskId = 'mesh-351641344', optionalVariantId = `${taskId}-v2`
    const task = {
      id: taskId, title: 'Диаграммы', detail: '', kind: 'check', status: 'unknown', source: 'МЭШ',
      practiceVariants: [{ id: `${taskId}-v1`, title: 'Вариант 1' }, { id: optionalVariantId, title: 'Вариант 2' }],
      problems: [
        { id: `${taskId}-v1-p1`, number: 1, title: 'Круговая диаграмма', detail: '', source: 'Лист учителя', variantId: `${taskId}-v1` },
        { id: `${taskId}-v2-p1`, number: 1, title: 'Столбчатая диаграмма', detail: '', source: 'Лист учителя', variantId: optionalVariantId },
      ], testToken: 'diagrams-check',
    } as DayTask
    const optional = { id: 'student-token:a', taskId, variantId: optionalVariantId,
      action: 'variant-optional', decidedAt: at(102) } as ParentCompletionEvent
    expect(lessonWorkItems([task], [], [], [], {}, {}).map((item) => item.id)).toEqual([
      `${taskId}-v1-p1`, `${taskId}-v2-p1`, 'quiz:diagrams-check',
    ])
    expect(lessonWorkItems([task], [], [], [optional], {}, {}).map((item) => item.id)).toEqual([
      `${taskId}-v1-p1`, 'quiz:diagrams-check',
    ])
  })
})
