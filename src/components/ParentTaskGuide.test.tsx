import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ParentTaskGuide from './ParentTaskGuide'
import type { ParentTaskGuide as Guide } from '@/lib/dayStore'

describe('one parent route component', () => {
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
