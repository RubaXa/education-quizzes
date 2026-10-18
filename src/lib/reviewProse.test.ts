import { describe, expect, it } from 'vitest'
import { formatReviewObservation, formatReviewProse, parentGuideProseErrors, reviewProseErrors, taskSupportProseErrors } from './reviewProse'

/** @see ../../docs/modules/reviews/review-criteria-provenance.md#readable-feedback */
describe('типографика обратной связи', () => {
  it('preserves the old empty rendering of missing legacy fields', () => {
    expect(formatReviewProse(undefined)).toBe('')
    expect(formatReviewProse(null)).toBe('')
    expect(formatReviewObservation(undefined)).toBe('')
  })
  it.each([
    ['30×29:2 ты вычислил верно:эта формула считает пары из30объектов.', '30 × 29 : 2 ты вычислил верно: эта формула считает пары из 30 объектов.'],
    ['Отрезка,а в формуле взято30точек.', 'Отрезка, а в формуле взято 30 точек.'],
    ['Сколько точек от0до30,если учесть оба конца?', 'Сколько точек от 0 до 30, если учесть оба конца?'],
    ['№8:31×30:2=465;ответ232.', '№ 8: 31 × 30 : 2 = 465; ответ 232.'],
    ['Длина 0,5 см; начало в 12:30, 18.10.2026. 6-й класс, 6Р; H2O, B2, Starlight 6.', 'Длина 0,5 см; начало в 12:30, 18.10.2026. 6-й класс, 6Р; H2O, B2, Starlight 6.'],
    ['См. https://example.com/от0до30?q=30×29:2 и `от0до30`.', 'См. https://example.com/от0до30?q=30×29:2 и `от0до30`.'],
    ['Проверка:14+12+...+2=56.', 'Проверка: 14 + 12 + ... + 2 = 56.'],
    ['Сумма 14+12+…+2=56.', 'Сумма 14 + 12 + … + 2 = 56.'],
    ['S=5×7+7×5=70; W=S×S=70×70=4900.', 'S = 5 × 7 + 7 × 5 = 70; W = S × S = 70 × 70 = 4900.'],
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

  it('spaces observation prose while preserving the literal calculation', () => {
    expect(formatReviewObservation('Ответ23варианта,запись14×13:2=91.')).toBe('Ответ 23 варианта, запись 14×13:2=91.')
  })
  it('checks authored review fields outside feedback, excluding exact sources and old history', () => {
    const review = { summary: 'Итог23варианта', nextStep: 'Проверь7точек.',
      items: [{ label: 'Номер2', observed: 'Ответ23варианта.', note: 'Дают56отрезков.' }],
      requirementChecks: [{ action: 'Выбери2слова.', meshExcerpt: 'Выбери2слова.', materialExcerpt: 'Из7слов.',
        explanation: 'Видно2слова.', evidence: { observation: 'Видно2слова.' } }],
      assessmentBasis: { observed: '14×13:2=91', comparison: 'Сравни7точек.', sources: [{ ref: 'book:14', excerpt: 'Выпиши2слова.' }] },
      history: [{ summary: 'Старый итог23варианта' }] }
    const before = JSON.stringify(review), errors = reviewProseErrors(review)
    for (const field of ['summary', 'nextStep', 'items[0].label', 'items[0].observed', 'items[0].note',
      'requirementChecks[0].action', 'requirementChecks[0].explanation', 'requirementChecks[0].evidence.observation', 'assessmentBasis.comparison'])
      expect(errors.some(error => error.startsWith(`${field}:`))).toBe(true)
    expect(errors.join('\n')).not.toMatch(/meshExcerpt|materialExcerpt|sources|history|assessmentBasis.observed/)
    expect(JSON.stringify(review)).toBe(before)
  })
  it('checks all authored guide fields and leaves identity/source anchors untouched', () => {
    const guide = { overview: 'Разбор2номеров.', boundary: 'Только2номера.', stages: [{ id: 'stage2', title: 'Этап2',
      expected: 'Найди7слов.', hintPreview: 'Из7слов?', revealPreview: 'Вот2слова.', answer: '2слова',
      rows: [{ label: 'Номер2', value: '7слов', explanation: 'Осталось5слов.' }],
      verification: [{ value: '2+5=7' }], source: { ref: 'book:7', excerpt: 'Найди7слов.' } }] }
    const before = JSON.stringify(guide), errors = parentGuideProseErrors(guide)
    for (const field of ['overview', 'boundary', 'stages[0].title', 'stages[0].expected', 'stages[0].hintPreview',
      'stages[0].revealPreview', 'stages[0].answer', 'stages[0].rows[0].label', 'stages[0].rows[0].value',
      'stages[0].rows[0].explanation', 'stages[0].verification[0].value'])
      expect(errors.some(error => error.startsWith(`parentGuide.${field}:`))).toBe(true)
    expect(errors.join('\n')).not.toMatch(/\.id:|\.source\./)
    expect(JSON.stringify(guide)).toBe(before)
  })
  it('checks source-material prose and reading aids without checking source receipts or originals', () => {
    expect(reviewProseErrors({ purpose: 'source-material', sourceAnalysis: { nextStep: 'Добавь2страницы.',
      evidence: [{ text: 'Точная запись:2страницы' }] } })).toHaveLength(1)
    const errors = taskSupportProseErrors({ original: { text: 'Точная запись:2страницы' },
      support: { facts: [{ value: '2точки' }], firstQuestion: 'Где2точки?' },
      materialRequest: { question: 'Какие2страницы?' } })
    expect(errors).toHaveLength(3)
    expect(errors.join('\n')).not.toContain('original')
  })
})
