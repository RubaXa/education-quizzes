// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProblemCard } from './ProblemCard'

const problem = { id: 'p1', number: 1, title: 'Марки Ивана', detail: '', source: 'teacher' }

// @see ../../docs/product/status-presentation.md#components
describe('compact problem status', () => {
  it('shows one ready icon without repeating Не начато in every numbered row', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<ProblemCard problem={problem} state={{ tone: 'ready', label: 'Не начато' }}><p>Условие</p></ProblemCard>)
    const summary = host.querySelector('summary')!
    expect(summary.textContent).toBe('№ 1. Марки Ивана')
    expect(summary.getAttribute('aria-label')).toContain('Не начато')
    expect(summary.querySelector('[data-status="ready"]')).not.toBeNull()
    expect(host.querySelector('details')?.open).toBe(false)
  })
  it('retains a concise visible label when a photo is waiting for review', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<ProblemCard problem={problem} state={{ tone: 'waiting', label: 'Фото получено · ждёт проверки' }}><p>Условие</p></ProblemCard>)
    expect(host.querySelector('summary')?.textContent).toContain('Ждёт проверки')
    expect(host.querySelector('[data-status="waiting"]')).not.toBeNull()
  })
})
