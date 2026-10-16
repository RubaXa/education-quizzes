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

  it('передаёт только безопасную причину недостающего фото, без экспертного объяснения', () => {
    const result = studentReviewProjection({ date: '2026-10-15', taskId: 'mesh-218-223', status: 'cannot-assess',
      assessmentBasis: { outcome: 'unresolved', unresolvedReason: 'missing-evidence',
        limitation: 'Второй номер за кадром', requirement: 'Учитель назначил два номера' },
      studentFeedback: { title: '№ 218 проверен; № 223 не виден', confirmed: 'Первый номер виден',
        focus: 'Второй номер не виден', question: 'Покажи второй номер?' } })
    expect(result.assessmentBasis).toEqual({ outcome: 'unresolved', unresolvedReason: 'missing-evidence' })
    expect(result).not.toHaveProperty('summary')
  })
  it('показывает ребёнку только проверяемую цепочку по номеру без закрытого ключа', () => {
    const result = studentReviewProjection({ date: '2026-10-15', taskId: 'mesh-218-223', status: 'cannot-assess',
      requirementChecks: [{ id: 'mesh-223', action: 'Выписать олицетворения', meshExcerpt: 'Упр. 223: выписать средства выразительности',
        materialExcerpt: 'Найдите олицетворения', evidence: { state: 'outside-frame', uploadId: 'photo', observation: 'Запись за краем кадра', secret: 'ключ' },
        result: 'unknown', explanation: 'Покажи только этот номер', privateNote: 'ключ' }] })
    expect(result.requirementChecks[0]).toEqual({ id: 'mesh-223', action: 'Выписать олицетворения', meshExcerpt: 'Упр. 223: выписать средства выразительности',
      materialExcerpt: 'Найдите олицетворения', evidence: { state: 'outside-frame', uploadId: 'photo', observation: 'Запись за краем кадра' },
      result: 'unknown', explanation: 'Покажи только этот номер' })
    expect(JSON.stringify(result)).not.toContain('ключ')
  })
})
