// @see ../../docs/product/design-system.md#mobile-card-headings
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ProblemGroup from './ProblemGroup'

describe('numbered sheet heading', () => {
  it('keeps an incomplete sheet closed by default', () => {
    const html = renderToStaticMarkup(<ProblemGroup id="sheet" title="Лист" problems={[
      { id: 'sheet-p01', number: 1, title: 'Задача', detail: '', source: 'Учитель' },
    ]} uploads={[]} reviews={[]} localPendingCount={0} sourceCount={1} ready><p>Условие</p></ProblemGroup>)
    expect(html).toContain('hidden=""')
    expect(html).toContain('problem-group-chevron')
    expect(html).not.toContain('Открыть лист, решения и проверки')
    expect(html).not.toContain('Фото ещё нет')
  })

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

  it('shows the agreed short title and variant subtitle without operational metadata', () => {
    const html = renderToStaticMarkup(<ProblemGroup id="sheet" title="Подготовка: диаграммы" subtitle="2 варианта из листа учителя"
      problems={[{ id: 'p1', number: 1, title: 'Марки Ивана', detail: '', source: 'Лист учителя' }]}
      uploads={[]} reviews={[]} localPendingCount={0} sourceCount={1} ready><p>Варианты</p></ProblemGroup>)
    expect(html).toContain('Подготовка: диаграммы')
    expect(html).toContain('2 варианта из листа учителя')
    expect(html).not.toContain('Фото ещё нет')
    expect(html).not.toContain('Откройте номера')
  })
})
