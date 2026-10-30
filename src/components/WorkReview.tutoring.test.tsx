import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WorkReview from './WorkReview'
import type { DayWorkReview } from '@/lib/dayStore'

describe('personal step explanation', () => {
  it.each([false, true])('shows an explanation rather than report headings, parent=%s', parent => {
    const review = { id: 'review', taskId: 'digits', status: 'partial', studentFeedback: {
      title: 'От одной цифры к набору', confirmed: 'Способ с 6 уже зачтён.',
      focus: 'У нескольких цифр сумма может быть больше 9.', question: 'Проверь выбранную пару целиком.',
      steps: [{ stageId: 'sum', uploadId: 'photo', location: 'первая строка', observation: '1 + 2 + 3 + 6 = 12', explanation: 'Ты верно проверил делимость на каждую записанную цифру.', status: 'correct' }],
    }, assessmentBasis: { requirement: 'Original condition', observed: 'Literal work', comparison: 'Private comparison', outcome: 'not-met', sources: [] } } as unknown as DayWorkReview
    const html = renderToStaticMarkup(<WorkReview parent={parent} uploads={[]} review={review} />)
    expect(html).toContain('Ты верно проверил делимость')
    expect(html).toContain('1 + 2 + 3 + 6 = 12')
    expect(html).not.toContain('Уже получилось')
    expect(html).not.toContain('Проверь здесь')
    expect(html).not.toContain('Один вопрос')
    expect(html).toContain('<details class="day-work-review-evidence"')
    expect(html).toContain('Условие и основания проверки')
  })
  it('retains readable historical feedback without inventing missing steps', () => {
    const html = renderToStaticMarkup(<WorkReview uploads={[]} review={{ id: 'old', taskId: 'old', status: 'partial', studentFeedback: { title: 'Старый разбор', confirmed: 'Верная часть сохранена.', focus: 'Конкретный переход объяснён.', question: 'Проверь этот переход.' } }} />)
    expect(html).toContain('Верная часть сохранена.')
    expect(html).not.toContain('Уже получилось')
  })
})
