// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { DayProblem, DaySourceResearch } from '@/lib/dayStore'
import ProblemStatement from './ProblemStatement'

// @see ../../docs/product/adaptive-problem-card.md#происхождение-задачи
const problem = { id: 'math-p3', number: 3, title: 'Найти ошибку', detail: 'Решить', source: 'Лист учителя',
  original: { text: 'Дано: DF = 9,3 см. Найти ошибку.', attachmentRef: 'sheet' },
} as DayProblem
const roots: ReturnType<typeof createRoot>[] = []
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()) })

async function mount(sourceResearch?: DaySourceResearch) {
  const host = document.createElement('div')
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(<ProblemStatement problem={problem} links={[]} parent sourceResearch={sourceResearch} />))
  const trigger = host.querySelector<HTMLButtonElement>('.problem-statement-source-trigger')!
  return { host, trigger }
}

describe('compact source provenance', () => {
  it('distinguishes absent research from a documented unsuccessful search', async () => {
    const absent = await mount()
    expect(absent.trigger.getAttribute('aria-label')).toContain('Происхождение не проверено')
    expect(absent.host.querySelector('.problem-statement-source-detail')).toBeNull()
    await act(async () => absent.trigger.click())
    expect(absent.host.textContent).toContain('Поиск более раннего источника не записан')

    const notFound = await mount({ status: 'not-found', title: 'Поиск прототипа', match: 'Проверены указанные сборники; совпадений нет', keyStatus: 'unavailable' })
    expect(notFound.trigger.getAttribute('aria-label')).toContain('Подтверждённый источник не найден')
    await act(async () => notFound.trigger.click())
    expect(notFound.host.textContent).toContain('Проверены указанные сборники; совпадений нет')
    expect(notFound.trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps the verified source accessible in the same position', async () => {
    const verified = await mount({ status: 'verified', title: 'Сборник задач', match: 'Условие и числа совпали', keyStatus: 'verified' })
    expect(verified.trigger.querySelector('[data-status="complete"]')).not.toBeNull()
    await act(async () => verified.trigger.click())
    expect(verified.host.textContent).toContain('Условие и числа совпали')
  })
})
