import { describe, expect, it } from 'vitest'
import { grade, summarize } from './quiz'
import type { AnswerKey, Assignment } from './quiz'

const assignment: Assignment = {
  schemaVersion: 1,
  testId: 'grading-check',
  title: 'Проверка оценивания',
  subject: 'Математика',
  questions: [
    { id: 'zero', kind: 'number', prompt: 'Чему равен нуль?', points: 1 },
    { id: 'many', kind: 'multiple', prompt: 'Выберите оба числа', points: 2 },
    { id: 'reason', kind: 'long', prompt: 'Объясните ответ', points: 3 },
  ],
  status: 'submitted',
  answers: { zero: '', many: ['b', 'a'], reason: 'Объяснение ученика' },
  startedAt: null,
  updatedAt: null,
  submittedAt: null,
}

const key: AnswerKey = {
  entries: {
    zero: { correct: '0', explanation: 'Нужен ответ.', source: 'Тема: нуль' },
    many: { correct: ['a', 'b'] },
    reason: {},
  },
}

describe('grading', () => {
  it('does not accept a blank numeric answer as zero', () => {
    const results = grade(assignment, key)
    expect(results[0]).toMatchObject({ points: 0, explanation: 'Нужен ответ.' })
    expect(results[1].points).toBe(2)
  })

  it('keeps written answers pending until a manual review arrives', () => {
    const pending = grade(assignment, key)
    expect(summarize(pending)).toEqual({ earned: 2, possible: 6, pending: 1 })

    const reviewed = grade(assignment, key, {
      entries: { reason: { points: 2, explanation: 'Нужна точная запись.' } },
    })
    expect(summarize(reviewed)).toEqual({ earned: 4, possible: 6, pending: 0 })
    expect(reviewed[2].explanation).toBe('Нужна точная запись.')
  })
})
