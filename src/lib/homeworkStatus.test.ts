import { describe, expect, it } from 'vitest'
import { lessonWorkItems, quizRequirement, requiredQuizRequirement } from './homeworkStatus'
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
      { ...passed, retry: { points: 9, maxPoints: 10 } }).state).toBe('done')
  })

  it('requires correction below 85 percent', () => {
    expect(quizRequirement('root', root, { root: { points: 33, maxPoints: 40 } }).state).toBe('todo')
  })

  it('a parent request reopens even a previously verified reading task', () => {
    const task = { id: 'mesh-reading', title: 'Английский', kind: 'check', status: 'verified', testToken: 'root' } as DayTask
    const items = lessonWorkItems([task], [], [], [], { root: { ...root.root, followupRequested: true } }, passed)
    expect(items).toHaveLength(1)
    expect(items[0].state).toBe('todo')
  })

  it('excludes an optional chain across attempts and restores it when required again', () => {
    const chain = { root: { status: 'submitted', testId: 'math-1', familyOptional: true },
      retry: { status: 'open', testId: 'math-2', linkedToTestId: 'math-1' } }
    expect(quizRequirement('root', chain, {})).toEqual({ state: 'optional', detail: 'По желанию · не входит в итог' })
    expect(requiredQuizRequirement('root', chain, {})).toBeNull()
    expect(quizRequirement('root', { ...chain, root: { ...chain.root, familyOptional: false } }, {}).state).toBe('todo')
  })

  it('removes only the quiz from a teacher worksheet, preserving its problems', () => {
    const task = { id: 'mesh-math', title: 'Диаграммы', kind: 'check', status: 'unknown', testToken: 'root',
      problems: [{ id: 'math-p1', number: 1, title: 'Диаграмма', detail: '', source: 'Лист учителя' }] } as DayTask
    const optional = { root: { status: 'open', testId: 'math-1', familyOptional: true } }
    expect(lessonWorkItems([task], [], [], [], optional, {}).map((item) => item.id)).toEqual(['math-p1'])
    expect(lessonWorkItems([task], [], [], [], { root: { ...optional.root, familyOptional: false } }, {}).map((item) => item.id)).toEqual(['math-p1', 'quiz:root'])
  })

  it('removes an optional standalone reading check from required work without deleting its source', () => {
    const task = { id: 'mesh-read', title: 'Прочитать параграф', kind: 'read', status: 'unknown', testToken: 'root' } as DayTask
    expect(lessonWorkItems([task], [], [], [], { root: { status: 'open', familyOptional: true } }, {})).toEqual([])
  })
})
