// @see ../../docs/product/design-system.md#mobile-card-headings
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ProblemGroup from './ProblemGroup'

describe('numbered sheet heading', () => {
  it('keeps the visible count short and the full meaning accessible', () => {
    const problems = [3, 4, 6, 7].map((number) => ({
      id: `problem-${number}`, number, title: `Задача ${number}`, detail: '', source: 'Лист учителя',
    }))
    const html = renderToStaticMarkup(<ProblemGroup id="sheet" title="Геометрия: задачи 3, 4, 6 и 7"
      problems={problems} uploads={[]} reviews={[]} localPendingCount={0} sourceCount={1} ready>
      <p>Условия</p>
    </ProblemGroup>)
    expect(html).toContain('aria-label="0 из 4 завершено"')
    expect(html).toContain('>0 из 4</span>')
    expect(html).not.toContain('>0 из 4 завершено</span>')
  })
})
