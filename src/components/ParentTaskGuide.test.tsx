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
        hintPreview: `Подсказка ${id}`, revealPreview: `Шаг ${id}`,
        source: { kind: 'teacher-file', label: 'Лист', ref: 'sheet', excerpt: 'условие' },
      })),
    }
    const html = renderToStaticMarkup(<ParentTaskGuide guide={guide} />)
    expect(html).toContain('<details class="day-parent-guide day-parent-learning-route"')
    expect(html).toContain('<strong>Разбор для родителя</strong>')
    expect(html).not.toContain('От условия к ответу')
    expect(html).toContain('>Ответ</button>')
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
    expect(markup).toContain('>Подсказка</button>')
    expect(markup).toContain('>Весь шаг</button>')
    expect(markup).toContain('Выбрать подсказку для этапа')
    expect(markup).not.toContain('Ответ:')
  })

  it('puts the specific next action inside the sourced parent route', () => {
    const guide: Guide = {
      kind: 'structured-notes', presentation: 'learning-route', pattern: 'source-evidence', revision: 2,
      overview: 'Упр. 199: что засчитать и что исправить', stages: [{ id: 'evidence', title: 'Сверить ответы', expected: 'Проверить слово',
        source: { kind: 'textbook', label: 'Семейный учебник', ref: 'book:106', excerpt: 'близкое слово' } }],
    }
    const markup = renderToStaticMarkup(<ParentTaskGuide guide={guide} review={{ id: 'review', taskId: 'mesh-351709033', status: 'partial',
      nextStep: 'Исправить только «вековой»: подобрать прилагательное перед «лес».',
      items: [{ stageId: 'evidence', label: 'Слово', status: 'incorrect', observed: 'сто лет', note: 'Не заменяет прилагательное' }] }} />)
    expect(markup).toContain('Что осталось сделать')
    expect(markup).toContain('Исправить только «вековой»')
    expect(markup).toContain('Не заменяет прилагательное')
  })
})
