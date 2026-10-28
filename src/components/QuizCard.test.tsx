import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import QuizCard from './QuizCard'
import type { QuizCardAttempt } from '@/lib/quizCardViewModel'

it('keeps an optional placement separate from the family requirement switch', () => {
  const open: QuizCardAttempt = { token: 'example', testId: 'math', slug: 'math', title: 'Олимпиада', status: 'open', answered: 0, total: 1 }
  expect(renderToStaticMarkup(<QuizCard chain={[open]} parent placementOptional />)).not.toContain('Учитывать тест')
  expect(renderToStaticMarkup(<QuizCard chain={[open]} parent />)).toContain('Учитывать тест')
})

/** @see ../../docs/modules/assessments/quizzes.md#followup-request */
describe('result and parent follow-up action', () => {
  const result: QuizCardAttempt = { token: 'example', testId: 'english-1', slug: 'english', title: 'Английский',
    status: 'submitted', answered: 39, total: 39, points: 34, maxPoints: 39 }
  it('shows compact result and request button only to the parent', () => {
    const parent = renderToStaticMarkup(<QuizCard chain={[result]} parent />)
    const student = renderToStaticMarkup(<QuizCard chain={[result]} parent={false} />)
    expect(parent).toContain('Создать новый тест с учётом всех попыток')
    expect(parent).toContain('Результат')
    expect(parent).not.toContain('Посмотреть результат')
    expect(student).not.toContain('Создать новый тест с учётом всех попыток')
  })
  it('shows the request as pending rather than completed', () => {
    const html = renderToStaticMarkup(<QuizCard chain={[{ ...result, followupRequested: true }]} parent />)
    expect(html).toContain('Новый тест запрошен')
    expect(html).toContain('day-quiz-lineage-score complete')
    expect(html).toContain('day-quiz-request-state')
  })
  it('keeps an older attempt action visible but disabled when it already has a continuation', () => {
    const html = renderToStaticMarkup(<QuizCard chain={[result]} parent allowFollowupRequest={false} />)
    expect(html).toContain('disabled="" aria-label="Создать новый тест с учётом всех попыток"')
  })
  it('offers the same action including after 100%', () => {
    expect(renderToStaticMarkup(<QuizCard chain={[{ ...result, points: 38, maxPoints: 40 }]} parent />)).toContain('Создать новый тест с учётом всех попыток')
    expect(renderToStaticMarkup(<QuizCard chain={[{ ...result, points: 40, maxPoints: 40 }]} parent />)).toContain('Создать новый тест с учётом всех попыток')
  })
  it('keeps the request available below the passing threshold', () => {
    expect(renderToStaticMarkup(<QuizCard chain={[{ ...result, points: 20 }]} parent />)).toContain('Создать новый тест с учётом всех попыток')
  })
  it('waits for a checked result before offering a linked test', () => {
    const pending = renderToStaticMarkup(<QuizCard chain={[{ ...result, points: undefined, maxPoints: undefined }]} parent />)
    expect(pending).toContain('disabled="" aria-label="Создать новый тест с учётом всех попыток"')
  })
})

/** @see ../../docs/modules/assessments/quizzes.md#optional-quiz */
describe('one family requirement switch on the shared test card', () => {
  const open: QuizCardAttempt = { token: 'root', testId: 'math-1', slug: 'math', title: 'Диаграммы', status: 'open', answered: 0, total: 20 }
  it('offers the existing switch to a parent on an active required test', () => {
    const html = renderToStaticMarkup(<QuizCard chain={[open]} parent />)
    expect(html).not.toContain('Обязателен')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
  })
  it('shows a voluntary test to a pupil without an editing control', () => {
    const html = renderToStaticMarkup(<QuizCard chain={[{ ...open, familyOptional: true }]} parent={false} />)
    expect(html).not.toContain('По желанию')
    expect(html).not.toContain('role="switch"')
    expect(html).toContain('Пройти тест')
  })
  it('keeps the choice on a retry and hides the switch after submission', () => {
    const retry = { ...open, token: 'retry', testId: 'math-2', linkedToTestId: 'math-1' }
    const active = renderToStaticMarkup(<QuizCard chain={[{ ...open, status: 'submitted', familyOptional: true }, retry]} parent />)
    expect(active).not.toContain('По желанию')
    expect(active).toContain('aria-label="Учитывать тест')
    expect(active).toContain('aria-checked="false"')
    const finished = renderToStaticMarkup(<QuizCard chain={[{ ...open, status: 'submitted', familyOptional: true }]} parent />)
    expect(finished).not.toContain('role="switch"')
  })
})
