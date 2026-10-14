import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ParentTaskGuide from './ParentTaskGuide'
import type { ParentTaskGuide as Guide } from '@/lib/dayStore'

describe('one parent route component', () => {
  it('keeps the parent route and every math stage closed until opened', () => {
    const guide: Guide = {
      kind: 'worked-solution', presentation: 'math-route', routeProfile: 'standard', revision: 1,
      overview: 'Разбор', stages: ['given', 'solution', 'answer'].map((id) => ({
        id, title: id, role: id as 'given' | 'solution' | 'answer', expected: id,
        source: { kind: 'teacher-file', label: 'Лист', ref: 'sheet', excerpt: 'условие' },
      })),
    }
    const html = renderToStaticMarkup(<ParentTaskGuide guide={guide} />)
    expect(html).toContain('<details class="day-parent-guide day-parent-learning-route"')
    expect(html).toContain('<strong>Разбор</strong>')
    expect(html).not.toContain('От условия к ответу')
    expect((html.match(/<details class="day-learning-route-stage [^"]*" open=""/g) ?? []).length).toBe(0)
  })

  it('renders a sourced text-plan route and overlays reviewed work', () => {
    const guide: Guide = {
      kind: 'text-structure', presentation: 'learning-route', pattern: 'text-plan', revision: 1,
      overview: 'Как проверить план', boundary: 'Форма плана не указана в МЭШ.',
      stages: ['theme', 'speech', 'plan'].map((id) => ({ id, title: id, expected: `Эталон ${id}`,
        reviewLabels: [id], hintPreview: `Вопрос ${id}`, revealPreview: `Показать ${id}`,
        source: { kind: 'mesh', label: 'МЭШ', ref: 'mesh-example', excerpt: 'план' } })),
    }
    const markup = renderToStaticMarkup(<ParentTaskGuide guide={guide} review={{ id: 'review', taskId: 'mesh-example',
      assessmentBasis: { outcome: 'unresolved' },
      workCoverage: { state: 'complete', note: 'Все части видны', sourceRef: 'МЭШ', reviewCheckedAt: null, recordedAt: null },
      items: [{ label: 'theme', status: 'correct', observed: 'Тема записана' },
        { label: 'plan', status: 'cannot-assess', observed: 'План есть', note: 'Форма спорна' }] }} />)
    expect(markup).toContain('Как проверить план')
    expect(markup).toContain('day-parent-learning-route')
    expect(markup).toContain('Форма спорна')
    expect(markup).toContain('Критерий формы спорен')
    expect(markup).toContain('от ребёнка пока ничего не требуется')
    expect(markup).toContain('Отправить подсказку')
    expect(markup).toContain('Показать этот шаг')
    expect(markup).not.toContain('Ответ:')
  })
})
