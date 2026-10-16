// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { DayProblem, DaySourceResearch } from '@/lib/dayStore'
import ProblemTaskCard from './ProblemTaskCard'

// @see ../../docs/modules/reviews/problem-card-design-decisions.md#flat-numbered-sheet
const problem = { id: 'math-p3', number: 3, title: 'Найти ошибку', detail: 'Решить', source: 'Лист учителя',
  original: { text: 'Дано: DF = 9,3 см. Найти ошибку.', attachmentRef: 'sheet' },
} as DayProblem
const roots: ReturnType<typeof createRoot>[] = []
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()) })

async function mount(sourceResearch?: DaySourceResearch) {
  const host = document.createElement('div')
  const root = createRoot(host)
  roots.push(root)
  await act(async () => root.render(<ProblemTaskCard problem={problem} state={{ tone: 'ready', label: 'Не начато' }}
    links={[]} parent sourceResearch={sourceResearch} uploads={[]} helpAccess="ready" onPhotos={() => undefined} />))
  const trigger = host.querySelector<HTMLButtonElement>('.problem-card-source-trigger')!
  return { host, trigger }
}

describe('source icon in the task heading', () => {
  it('distinguishes no recorded research from a documented unsuccessful search', async () => {
    const absent = await mount()
    expect(absent.trigger.closest('summary')).not.toBeNull()
    expect(absent.trigger.getAttribute('aria-label')).toContain('Происхождение не проверено')
    expect(absent.host.querySelector('.problem-card-source-detail')).toBeNull()
    await act(async () => absent.trigger.click())
    expect(absent.host.textContent).toContain('Поиск более раннего источника не записан')
    expect(absent.host.querySelector('details.problem-card')?.hasAttribute('open')).toBe(false)

    const notFound = await mount({ status: 'not-found', title: 'Поиск прототипа', match: 'Проверены указанные сборники; совпадений нет', keyStatus: 'unavailable' })
    expect(notFound.trigger.getAttribute('aria-label')).toContain('Подтверждённый источник не найден')
    await act(async () => notFound.trigger.click())
    expect(notFound.host.textContent).toContain('Проверены указанные сборники; совпадений нет')
    expect(notFound.trigger.getAttribute('aria-expanded')).toBe('true')
  })

  it('shows a verified source with a check in the same heading position', async () => {
    const verified = await mount({ status: 'verified', title: 'Сборник задач', match: 'Условие и числа совпали', keyStatus: 'verified' })
    expect(verified.trigger.closest('summary')).not.toBeNull()
    expect(verified.trigger.querySelector('[data-status="complete"]')).not.toBeNull()
    await act(async () => verified.trigger.click())
    expect(verified.host.textContent).toContain('Условие и числа совпали')
  })
})
