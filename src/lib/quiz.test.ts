import { describe, expect, it } from 'vitest'
import { countAnswered, grade, summarize } from './quiz'
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
    zero: { correct: '0', explanation: 'Нужен ответ.', source: 'Тема: нуль', learning: {
      rule: 'Пустой ответ не равен нулю.', why: 'Поле не заполнено.', textbook: 'Памятка, стр. 1.', nextStep: 'Прочитай пример.'
    } },
    many: { correct: ['a', 'b'], learning: { rule: 'Выбери два числа.', why: 'Оба нужны.', textbook: 'Памятка, стр. 2.', nextStep: 'Прочитай пример.' } },
    reason: { learning: { rule: 'Сначала объясни ход.', why: 'Нужна причина.', textbook: 'Памятка, стр. 3.', nextStep: 'Прочитай пример.' } },
  },
}

describe('grading', () => {
  it.each(['другим известиям', 'Другим известия', 'Из других сообщений'])('waits for semantic review of typed words: %s', answer => {
    const text = { ...assignment, textAnswerReviewVersion: 1 as const, questions: [{ id: 'news', kind: 'short' as const, prompt: 'Откуда узнали?', points: 1 }], answers: { news: answer } }
    const key = { entries: { news: { correct: 'другим известиям' } } }
    expect(grade(text, key)[0].points).toBeNull()
    expect(grade(text, key, { entries: { news: { points: 1, explanation: 'Смысл подтверждён по источнику.' } } })[0].points).toBe(1)
    expect(grade({ ...text, textAnswerReviewVersion: undefined }, key)[0].points).toBe(answer === 'другим известиям' ? 1 : 0)
  })
  it('counts only filled answers for the shared test list', () => {
    expect(countAnswered(assignment)).toBe(2)
    expect(countAnswered({ ...assignment, answers: { zero: '  ', many: [], reason: '' } })).toBe(0)
  })

  it('does not accept a blank numeric answer as zero', () => {
    const results = grade(assignment, key)
    expect(results[0]).toMatchObject({ points: 0, explanation: 'Нужен ответ.', learning: { rule: 'Пустой ответ не равен нулю.' } })
    expect(results[1].points).toBe(2)
    expect(results[1].learning).toBeUndefined()
  })

  it('keeps written answers pending until a manual review arrives', () => {
    const pending = grade(assignment, key)
    expect(summarize(pending)).toEqual({ earned: 2, possible: 6, pending: 1, skipped: 0, excluded: 0 })
    expect(pending[2].learning).toBeUndefined()

    const reviewed = grade(assignment, key, {
      entries: { reason: { points: 2, explanation: 'Нужна точная запись.' } },
    })
    expect(summarize(reviewed)).toEqual({ earned: 4, possible: 6, pending: 0, skipped: 0, excluded: 0 })
    expect(reviewed[2].explanation).toBe('Нужна точная запись.')
    expect(reviewed[2].learning?.rule).toBe('Сначала объясни ход.')
  })

  it('excludes optional unanswered items from the score and manual-review count', () => {
    const optional = { ...assignment,
      assessment: { policyVersion: 1 as const, mode: 'control-followup' as const,
        subjectAdapter: 'russian', unansweredPolicy: 'optional' as const },
      answers: { ...assignment.answers, reason: '' },
    }
    const results = grade(optional, key)
    expect(results[0]).toMatchObject({ skipped: true, points: null })
    expect(results[2]).toMatchObject({ skipped: true, points: null })
    expect(summarize(results)).toEqual({ earned: 2, possible: 2, pending: 0, skipped: 2, excluded: 0 })
  })
})
