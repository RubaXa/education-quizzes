import { describe, expect, it } from 'vitest'
import { studentReviewProjection } from './review-projection.mjs'

describe('публичная проекция разбора', () => {
  it('оставляет статус и адресный вопрос, удаляя экспертный текст из текущей и старой попытки', () => {
    const result = studentReviewProjection({
      date: '2026-10-15', taskId: 'mesh-99', status: 'partial', checkedAt: 'now',
      summary: 'Экспертный вывод', nextStep: 'Готовый шаг', source: 'закрытый ключ',
      challengeReview: { initialConcern: 'Закрытая повторная сверка', creditableAlternative: 'Точный ответ' },
      studentFeedback: { title: 'Проверь ход', confirmed: 'Начало верно', focus: 'Пункт 3', question: 'Что следует из пункта 3?', expected: 'секрет' },
      mathReasoning: { answer: 'correct', argument: 'incomplete', observed: '10', minimumNeeded: 'Решение' },
      assessmentBasis: { outcome: 'not-met', requirement: 'экспертное ожидание', comparison: 'ключ', sources: [{ kind: 'official-key' }] },
      items: [{ label: 'План', status: 'partial', observed: '10', expected: '11', note: 'ответ' }],
      history: [{ status: 'needs-fix', summary: 'старый ответ', items: [{ note: 'ключ' }], studentFeedback: { title: 'Первая попытка', focus: 'секрет' } }],
    })
    expect(result.status).toBe('partial')
    expect(result.studentFeedback.question).toContain('пункта 3')
    expect(result).not.toHaveProperty('summary')
    expect(result).not.toHaveProperty('challengeReview')
    expect(result.mathReasoning).not.toHaveProperty('minimumNeeded')
    expect(result.assessmentBasis).not.toHaveProperty('comparison')
    expect(result.items[0]).toEqual({ label: 'План', status: 'partial' })
    expect(result.history[0]).toEqual({ status: 'needs-fix', studentFeedback: { title: 'Первая попытка' } })
  })
})
