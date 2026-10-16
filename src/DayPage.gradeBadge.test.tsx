// @vitest-environment jsdom
// @see ../docs/modules/school-diary/grades.md#grade-badge
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { GradeBadge } from './DayPage'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('subject grade badge', () => {
  it.each([
    { average: 4.5, tone: 'watch' },
    { average: 4.75, tone: 'neutral' },
    { average: 5, tone: 'excellent' },
  ])('opens a verified scenario from $average ($tone)', async ({ average }) => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const grades = average === 4.75 ? [5, 5, 4, 5] : average === 4.5 ? [5, 4] : [5, 5]
    await act(async () => {
      root.render(<div className="day-subject-status"><GradeBadge
        summary={{ id: 'subject', name: 'Предмет', average }}
        details={{ id: 'subject', name: 'Предмет', displayed_average: average, scenario_verified: true, grades: grades.map((mark) => ({ mark, weight: 1 })) }}
        threshold={4.5}
      /></div>)
    })
    const button = host.querySelector<HTMLButtonElement>('.day-grade-button')
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-expanded')).toBe('false')
    await act(async () => { button?.click() })
    expect(button?.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('.day-grade-result')?.textContent).toContain(average === 4.75 ? '4,75 → 4,60' : average === 4.5 ? '4,50 → 4,33' : '5,00 → 4,67')
    if (average === 4.75) {
      await act(async () => { host.querySelector<HTMLButtonElement>('.day-grade-choices button:last-child')?.click() })
      expect(host.querySelector('.day-grade-result')?.textContent).toContain('4,75 → 4,80')
    }
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('keeps an unverified grade expandable without inventing a forecast', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<GradeBadge summary={{ id: 'subject', name: 'Предмет', average: 4.75 }} threshold={4.5} />) })
    await act(async () => { host.querySelector<HTMLButtonElement>('.day-grade-button')?.click() })
    expect(host.querySelector('.day-grade-result')).toBeNull()
    expect(host.querySelector('.day-grade-unavailable')?.textContent).toContain('Прогноз ждёт сверки')
    await act(async () => { root.unmount() })
    host.remove()
  })
})
