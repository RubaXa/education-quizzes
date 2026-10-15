// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import QuizCard from './QuizCard'
import type { QuizCardAttempt } from '@/lib/quizCardViewModel'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/** @see ../../docs/product/quizzes.md#attempt-time */
describe('time control in the existing quiz card', () => {
  const earlier: QuizCardAttempt = {
    token: 'first', testId: 'math-1', slug: 'math', title: 'Первый тест',
    status: 'submitted', answered: 5, total: 5, points: 4, maxPoints: 5,
    createdAt: { seconds: 1791936000 }, startedAt: { seconds: 1791939600 },
    updatedAt: { seconds: 1791943200 }, submittedAt: { seconds: 1791943200 },
  }
  const active: QuizCardAttempt = {
    token: 'second', testId: 'math-2', linkedToTestId: 'math-1', slug: 'math', title: 'Повторный тест',
    status: 'open', answered: 1, total: 5,
    createdAt: { seconds: 1792022400 }, startedAt: { seconds: 1792026000 },
    updatedAt: { seconds: 1792026600 }, submittedAt: null,
  }
  const roots: ReturnType<typeof createRoot>[] = []
  const hosts: HTMLElement[] = []
  afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => { root.unmount() })
    for (const host of hosts.splice(0)) host.remove()
  })

  it.each([true, false])('shows an icon-only disclosure for the active and previous attempt; parent=%s', async (parent) => {
    const host = document.createElement('div')
    document.body.append(host)
    hosts.push(host)
    const root = createRoot(host)
    roots.push(root)
    await act(async () => { root.render(<QuizCard chain={[earlier, active]} parent={parent} />) })
    const current = host.querySelector<HTMLButtonElement>('[aria-label="Показать время теста «Повторный тест»"]')
    const history = host.querySelector<HTMLButtonElement>('[aria-label="Показать время теста «Первый тест»"]')
    expect(current).not.toBeNull()
    expect(history).not.toBeNull()
    expect(host.textContent).toContain('Повторный тест')
    expect(host.textContent).toContain('Предыдущие тесты')
    expect(host.textContent).not.toContain('Последнее изменение')

    await act(async () => { current!.click() })
    expect(current!.getAttribute('aria-expanded')).toBe('true')
    expect(host.textContent).toContain('Создан')
    expect(host.textContent).toContain('Начат')
    expect(host.textContent).toContain('Последнее изменение')
    expect(host.querySelector('.day-quiz-time-details')?.textContent).toContain('15.10.2026, 03:00')
    expect(host.textContent).toContain('Не завершён')

    await act(async () => { host.querySelector<HTMLDetailsElement>('.day-quiz-history')!.open = true })
    await act(async () => { history!.click() })
    expect(current!.getAttribute('aria-expanded')).toBe('false')
    expect(history!.getAttribute('aria-expanded')).toBe('true')
    expect(host.textContent).not.toContain('Не завершён')
    expect(host.textContent).toContain('Завершён')
    expect(host.querySelectorAll('time')).toHaveLength(4)
  })

  it('does not invent absent timestamps in an older completed attempt', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    hosts.push(host)
    const root = createRoot(host)
    roots.push(root)
    await act(async () => { root.render(<QuizCard chain={[{ ...earlier, createdAt: undefined, startedAt: null, updatedAt: null, submittedAt: null }]} parent />) })
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Показать время теста «Первый тест»"]')!.click() })
    expect(host.textContent).toContain('Время неизвестно')
    expect(host.textContent).not.toContain('Не завершён')
  })
})
