import { describe, expect, it } from 'vitest'
import { projectGuidanceReveal } from './guidance-release.mjs'

describe('public stage reveal projection', () => {
  it('copies only selected stage fields and keeps private source metadata out', () => {
    const projected = projectGuidanceReveal({
      id: 'given', title: 'Прямая и направления', expected: 'Переходы ±1, ±2, ±4, ±8, ±16 дм', role: 'calculation',
      rows: [{ label: 'Симметрия', value: 'Можно считать последний переход равным +16', internal: 'must not leak' }],
      why: 'Парные переходы равны.', answer: 'wrong-stage answer', verification: [{ value: 'private check' }],
      reviewLabels: ['private review data'], source: { label: 'Лист учителя №2', ref: 'private-ref', excerpt: 'private-excerpt' },
    })
    expect(projected).toEqual({
      title: 'Прямая и направления', expected: 'Переходы ±1, ±2, ±4, ±8, ±16 дм', role: 'calculation',
      rows: [{ label: 'Симметрия', value: 'Можно считать последний переход равным +16' }], why: 'Парные переходы равны.',
      answer: '', verification: [], sourceLabel: 'Лист учителя №2',
    })
    expect(JSON.stringify(projected)).not.toMatch(/private-ref|private-excerpt|private review|wrong-stage|internal/)
  })

  it('includes explicit answer and verification only for the selected answer stage', () => {
    const projected = projectGuidanceReveal({ title: 'Ответ', expected: 'Проверить результат', role: 'answer', answer: '42',
      verification: [{ label: 'Подстановка', value: '42 = 42' }], source: { label: 'Учительский лист', ref: 'private', excerpt: 'private' } })
    expect(projected.answer).toBe('42')
    expect(projected.verification).toEqual([{ label: 'Подстановка', value: '42 = 42' }])
  })
})
