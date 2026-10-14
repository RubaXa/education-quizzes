import { describe, expect, it } from 'vitest'
import { lessonWorkItems, quizRequirement } from './homeworkStatus'
import type { DayTask } from './dayStore'

/** @see ../../docs/product/assessment-decision-graph.md#followup-threshold */
describe('one required self-check across its linked attempts', () => {
  const root = { root: { status: 'submitted', testId: 'english-1' } }
  const passed = { root: { points: 34, maxPoints: 39 } }

  it('counts a passing English test as done', () => {
    expect(quizRequirement('root', root, passed).state).toBe('done')
  })

  it('reopens after a parent request and follows the new attempt', () => {
    expect(quizRequirement('root', { root: { ...root.root, followupRequestedAt: true } }, passed).state).toBe('todo')
    const chain = { ...root, retry: { status: 'open', testId: 'english-2', linkedToTestId: 'english-1' } }
    expect(quizRequirement('root', chain, passed).state).toBe('todo')
    expect(quizRequirement('root', { ...chain, retry: { ...chain.retry, status: 'submitted' } },
      { ...passed, retry: { points: 8, maxPoints: 10 } }).state).toBe('done')
  })

  it('requires correction below 80 percent', () => {
    expect(quizRequirement('root', root, { root: { points: 31, maxPoints: 40 } }).state).toBe('todo')
  })

  it('a parent request reopens even a previously verified reading task', () => {
    const task = { id: 'mesh-reading', title: 'Английский', kind: 'check', status: 'verified', testToken: 'root' } as DayTask
    const items = lessonWorkItems([task], [], [], [], { root: { ...root.root, followupRequested: true } }, passed)
    expect(items).toHaveLength(1)
    expect(items[0].state).toBe('todo')
  })
})
