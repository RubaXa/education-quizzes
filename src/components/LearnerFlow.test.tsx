// @vitest-environment jsdom
/** @see ../../docs/modules/reviews/subject-aware-guidance.md#learner-flow */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import LearnerFlow from './LearnerFlow'
describe('learner process support', () => {
  it('shows one step and resets opt-in scaffolds on navigation without grading', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<LearnerFlow flow={{ version: 1, scope: 'Упр.5', meshExcerpt: 'упр.5', boundary: 'WB пока не сверена', goal: 'Свой диалог', source: { pageId: 'book:31', label: 'SB31', excerpt: 'Use the plan' }, stages: [
        { id: 'plan', title: 'Подумай о ролях', prompt: 'Кто начинает?', hint: 'Посмотри 2b', frame: 'Реплика официанта', sourceLabel: 'SB31 ex2b' },
        { id: 'check', title: 'Сверь заказ', prompt: 'Совпали блюда?', hint: 'Сравни конец и начало', frame: 'Проверь каждого гостя', sourceLabel: 'SB31 ex5' },
      ] }} />))
      expect(host.textContent).not.toContain('Совпали блюда?')
      expect(host.querySelector('details')!.open).toBe(false)
      host.querySelector('details')!.open = true
      const next = [...host.querySelectorAll('button')].find(b => b.textContent === 'Следующий шаг')!
      await act(async () => next.click())
      expect(host.textContent).not.toContain('Кто начинает?')
      expect(host.querySelector('details')!.open).toBe(false)
      expect(host.textContent).toContain('не означает, что работа проверена')
      expect(host.textContent).toContain('WB пока не сверена')
      const changed = { version: 1 as const, scope: 'Новая проверенная область', meshExcerpt: 'упр.5', boundary: 'WB пока не сверена', goal: 'Уточнённый диалог',
        source: { pageId: 'book:31', label: 'SB31', excerpt: 'Use the plan' }, stages: ['new-plan', 'new-check'].map(id => ({ id, title: id, prompt: 'Новая инструкция', hint: 'Новая опора', frame: 'Новая схема', sourceLabel: 'SB31 ex5' })) }
      await act(async () => root.render(<LearnerFlow key={`task:${JSON.stringify(changed)}`} flow={changed} />))
      expect(host.textContent).toContain('Шаг 1 из 2')
      expect(host.textContent).toContain('Новая инструкция')
      expect(host.querySelector('details')!.open).toBe(false)
      await act(async()=>root.render(<LearnerFlow key="reviewed" reviewed flow={changed}/>))
      const revisit=host.querySelector<HTMLDetailsElement>('.day-learner-flow-revisit')!
      expect(revisit.open).toBe(false)
      expect(revisit.querySelector('summary')?.textContent).toBe('Вернуться к условию и плану')
      expect(revisit.querySelector('.day-learner-flow-stage')?.textContent).toContain('Новая инструкция')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
