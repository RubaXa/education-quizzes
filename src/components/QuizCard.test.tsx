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
    expect(parent).toContain('Создать связанный тест по ошибкам')
    expect(parent).toContain('Результат')
    expect(parent).not.toContain('Посмотреть результат')
    expect(student).not.toContain('Создать связанный тест по ошибкам')
  })
  it('shows the request as pending rather than completed', () => {
    const html = renderToStaticMarkup(<QuizCard chain={[{ ...result, followupRequested: true }]} parent />)
    expect(html).toContain('Работа над ошибками запрошена')
    expect(html).toContain('day-quiz-lineage-score partial')
  })
  it('hides the request for an older attempt that already has a continuation', () => {
    const html = renderToStaticMarkup(<QuizCard chain={[result]} parent allowFollowupRequest={false} />)
    expect(html).not.toContain('Создать связанный тест по ошибкам')
  })
  it('offers the same action from 85% through 99%, but not after 100%', () => {
    expect(renderToStaticMarkup(<QuizCard chain={[{ ...result, points: 38, maxPoints: 40 }]} parent />)).toContain('Создать связанный тест по ошибкам')
    expect(renderToStaticMarkup(<QuizCard chain={[{ ...result, points: 40, maxPoints: 40 }]} parent />)).not.toContain('Создать связанный тест по ошибкам')
  })
  it('keeps the request available below the passing threshold', () => {
    expect(renderToStaticMarkup(<QuizCard chain={[{ ...result, points: 20 }]} parent />)).toContain('Создать связанный тест по ошибкам')
  })
  it('waits for a checked result before offering a linked test', () => {
    const pending = renderToStaticMarkup(<QuizCard chain={[{ ...result, points: undefined, maxPoints: undefined }]} parent />)
    expect(pending).not.toContain('Создать связанный тест по ошибкам')
  })
})

/** @see ../../docs/product/quizzes.md#optional-quiz */
describe('one family requirement switch on the shared test card', () => {
  const open: QuizCardAttempt = { token: 'root', testId: 'math-1', slug: 'math', title: 'Диаграммы', status: 'open', answered: 0, total: 20 }
  it('offers the existing switch to a parent on an active required test', () => {
    const html = renderToStaticMarkup(<QuizCard chain={[open]} parent />)
    expect(html).toContain('Обязателен')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
  })
  it('shows a voluntary test to a pupil without an editing control', () => {
    const html = renderToStaticMarkup(<QuizCard chain={[{ ...open, familyOptional: true }]} parent={false} />)
    expect(html).toContain('По желанию')
    expect(html).not.toContain('role="switch"')
    expect(html).toContain('Пройти тест')
  })
  it('keeps the choice on a retry and hides the switch after submission', () => {
    const retry = { ...open, token: 'retry', testId: 'math-2', linkedToTestId: 'math-1' }
    const active = renderToStaticMarkup(<QuizCard chain={[{ ...open, status: 'submitted', familyOptional: true }, retry]} parent />)
    expect(active).toContain('По желанию')
    expect(active).toContain('aria-checked="false"')
    const finished = renderToStaticMarkup(<QuizCard chain={[{ ...open, status: 'submitted', familyOptional: true }]} parent />)
    expect(finished).not.toContain('role="switch"')
  })
})
