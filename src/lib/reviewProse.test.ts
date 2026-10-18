import { describe, expect, it } from 'vitest'
import { formatReviewProse, reviewProseErrors } from './reviewProse'

/** @see ../../docs/modules/reviews/review-criteria-provenance.md#readable-feedback */
describe('типографика обратной связи', () => {
  it.each([
    ['30×29:2 ты вычислил верно:эта формула считает пары из30объектов.', '30 × 29 : 2 ты вычислил верно: эта формула считает пары из 30 объектов.'],
    ['Отрезка,а в формуле взято30точек.', 'Отрезка, а в формуле взято 30 точек.'],
    ['Сколько точек от0до30,если учесть оба конца?', 'Сколько точек от 0 до 30, если учесть оба конца?'],
    ['№8:31×30:2=465;ответ232.', '№ 8: 31 × 30 : 2 = 465; ответ 232.'],
    ['Длина 0,5 см; начало в 12:30, 18.10.2026. 6-й класс, 6Р; H2O, B2, Starlight 6.', 'Длина 0,5 см; начало в 12:30, 18.10.2026. 6-й класс, 6Р; H2O, B2, Starlight 6.'],
    ['См. https://example.com/от0до30?q=30×29:2 и `от0до30`.', 'См. https://example.com/от0до30?q=30×29:2 и `от0до30`.'],
  ])('форматирует %s без изменения значений', (raw, expected) => {
    expect(formatReviewProse(raw)).toBe(expected)
    expect(formatReviewProse(expected)).toBe(expected)
  })

  it('не пропускает новые склейки, сообщает поле и исправление, не меняет пакет', () => {
    const review = { studentFeedback: { confirmed: 'Пары из30объектов.', focus: 'Проверь условие.', question: 'Сколько точек от0до30?' } }
    expect(reviewProseErrors(review)).toEqual([
      'studentFeedback.confirmed: нужны читаемые пробелы. Предлагаемая запись: Пары из 30 объектов.',
      'studentFeedback.question: нужны читаемые пробелы. Предлагаемая запись: Сколько точек от 0 до 30?',
    ])
    expect(review.studentFeedback.confirmed).toBe('Пары из30объектов.')
    expect(reviewProseErrors({ studentFeedback: { confirmed: 'Пары из 30 объектов.' } })).toEqual([])
  })
})
