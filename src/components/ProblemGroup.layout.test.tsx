// @see ../../docs/shared/design/README.md#mobile-card-headings
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
    expect(html).toContain('aria-label="0 из 4 проверено; обязательная часть 0 из 4"')
    expect(html).toContain('>0 из 4</span>')
    expect(html).not.toContain('>0 из 4 завершено</span>')
  })

  it('shows actual work for a group with no required items without a zero-of-zero result', () => {
    const html = renderToStaticMarkup(<ProblemGroup id="optional-sheet" title="Лист спецкурса" requiredProblems={[]}
      problems={[{ id: 'p7', number: 7, title: 'Задача 7', detail: '', source: 'Лист' }, { id: 'p8', number: 8, title: 'Задача 8', detail: '', source: 'Лист' }]}
      uploads={[{ id: 'student:photo7', taskId: 'p7', status: 'reviewed' }, { id: 'student:photo8', taskId: 'p8', status: 'reviewed' }]}
      reviews={[{ id: 'r7', taskId: 'p7', status: 'verified', uploadIds: ['photo7'] }, { id: 'r8', taskId: 'p8', status: 'needs-fix', uploadIds: ['photo8'] }] as never}
      localPendingCount={0} sourceCount={1} ready><p>Условия</p></ProblemGroup>)
    expect(html).toContain('1 из 2 проверено, 1 требуют исправления')
    expect(html).not.toContain('0 из 0')
    expect(html).not.toContain('По желанию')
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
