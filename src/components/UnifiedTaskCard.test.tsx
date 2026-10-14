// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AssignmentBrief from './AssignmentBrief'
import QuizCard from './QuizCard'
import TaskGuidance from './TaskGuidance'
import type { DayTask } from '@/lib/dayStore'

/** @see ../../docs/product/subject-card-viewmodel.md#release-gate */
describe('one public task and quiz view', () => {
  it('shows the exact teacher instruction and origin without a private answer', () => {
    const task = { id: 'mesh-example', title: 'Тема и идея', detail: 'Посмотри страницы учебника.', meshText: 'Записать тему и идею.', source: 'МЭШ, запись урока.', kind: 'written', status: 'unknown' } as DayTask
    const html = renderToStaticMarkup(<AssignmentBrief task={task} />)
    expect(html).toContain('Задание учителя')
    expect(html).toContain('Записать тему и идею.')
    expect(html).toContain('МЭШ')
    expect(html).not.toContain('Откуда взято задание')
    expect(html).not.toContain('Готовый ответ')
  })

  it('renders only the selected parent help text', () => {
    const html = renderToStaticMarkup(<TaskGuidance items={[{ id: 'one', taskId: 'mesh-example', stageId: 'idea', stageIndex: 1, level: 'hint', text: 'Посмотри конец баллады.', guideRevision: 1, actorPersonId: 'parent', createdAt: null }]} />)
    expect(html).toContain('Посмотри конец баллады.')
    expect(html).toContain('Подсказка')
    expect(html).not.toContain('Показанный шаг')
  })

  it('shows a score percentage only after points are known', () => {
    const pending = { token: 'token', testId: 'test', title: 'Самопроверка', slug: 'quiz', status: 'submitted' as const, answered: 4, total: 4 }
    const waiting = renderToStaticMarkup(<QuizCard chain={[pending]} parent />)
    expect(waiting).toContain('Результат уточняется')
    expect(waiting).not.toContain('role="progressbar"')
    const scored = renderToStaticMarkup(<QuizCard chain={[{ ...pending, points: 3, maxPoints: 4 }]} parent />)
    expect(scored).toContain('75%')
    expect(scored).toContain('3 из 4')
  })

  it('shows an untouched quiz as an icon and count without repeating Не начат', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<QuizCard chain={[{ token: 'token', testId: 'test', title: 'Диаграммы', slug: 'quiz', status: 'open', answered: 0, total: 20 }]} parent />)
    expect(host.querySelector('.day-quiz-lineage-score')?.textContent).toBe('0 из 20')
    expect(host.querySelector('.day-quiz-lineage-score')?.getAttribute('aria-label')).toContain('Не начат')
    expect(host.textContent).not.toContain('Не начат')
  })
})
