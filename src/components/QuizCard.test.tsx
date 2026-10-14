import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import QuizCard from './QuizCard'
import type { QuizCardAttempt } from '@/lib/quizCardViewModel'

/** @see ../../docs/product/quizzes.md#followup-request */
describe('result and parent follow-up action', () => {
  const result: QuizCardAttempt = { token: 'example', testId: 'english-1', slug: 'english', title: 'Английский',
    status: 'submitted', answered: 39, total: 39, points: 34, maxPoints: 39 }
  it('shows compact result and request button only to the parent', () => {
    const parent = renderToStaticMarkup(<QuizCard chain={[result]} parent />)
    const student = renderToStaticMarkup(<QuizCard chain={[result]} parent={false} />)
    expect(parent).toContain('Запросить работу над ошибками')
    expect(parent).toContain('Результат')
    expect(parent).not.toContain('Посмотреть результат')
    expect(student).not.toContain('Запросить работу над ошибками')
  })
  it('shows the request as pending rather than completed', () => {
    const html = renderToStaticMarkup(<QuizCard chain={[{ ...result, followupRequested: true }]} parent />)
    expect(html).toContain('Работа над ошибками запрошена')
    expect(html).toContain('day-quiz-lineage-score partial')
  })
  it('hides the request for an older attempt that already has a continuation', () => {
    const html = renderToStaticMarkup(<QuizCard chain={[result]} parent allowFollowupRequest={false} />)
    expect(html).not.toContain('Запросить работу над ошибками')
  })
})
