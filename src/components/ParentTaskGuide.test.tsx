// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ParentTaskGuide from './ParentTaskGuide'
import type { ParentTaskGuide as Guide } from '@/lib/dayStore'

describe('one parent route component', () => {
  it('keeps the full-step action available after sending a hint, then closes both after reveal', async () => {
    const guide: Guide = {
      kind: 'worked-solution', presentation: 'math-route', routeProfile: 'standard', revision: 1,
      overview: 'Разбор', stages: [{ id: 'solution', title: 'Решение', role: 'solution', expected: 'Полный шаг',
        hintPreview: 'Подумай о связи', revealPreview: 'Покажи полный переход',
        source: { kind: 'teacher-file', label: 'Лист', ref: 'sheet', excerpt: 'условие' } }],
    }
    const onSend = vi.fn(async (_stage: Guide['stages'][number], _level: 'hint' | 'reveal') => {})
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () => root.render(<ParentTaskGuide guide={guide} onSend={onSend} />))
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Выбрать подсказку для этапа «Решение»"]')!.click())
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Отправить Пете')!.click())
      expect(host.querySelector('[aria-label="Выбрать подсказку для этапа «Решение»"]')).toBeNull()
      expect(host.querySelector('[aria-label="Выбрать показ полного шага для этапа «Решение»"]')).not.toBeNull()
      expect(host.textContent).toContain('Подсказка отправлена Пете.')

      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Выбрать показ полного шага для этапа «Решение»"]')!.click())
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Отправить Пете')!.click())
      expect(host.querySelector('[aria-label="Выбрать подсказку для этапа «Решение»"]')).toBeNull()
      expect(host.querySelector('[aria-label="Выбрать показ полного шага для этапа «Решение»"]')).toBeNull()
      expect(host.textContent).toContain('Весь шаг отправлен Пете.')
      expect(onSend.mock.calls.map(([stage, level]) => [stage.id, level])).toEqual([['solution', 'hint'], ['solution', 'reveal']])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

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

  it('excludes only the parent-disabled error from the compact family status', () => {
    const guide: Guide = { kind: 'structured-notes', presentation: 'learning-route', pattern: 'source-evidence', revision: 2,
      overview: 'Проверка ответа', stages: [{ id: 'evidence', title: 'Сверить шесть ответов с требованием', expected: 'Сверить слова',
        source: { kind: 'textbook', label: 'Учебник', ref: 'book:106', excerpt: 'упражнение' } }] }
    const review = { id: 'token:task', taskId: 'task', status: 'partial' as const,
      checkedAt: { seconds: 100, nanoseconds: 0 }, checkableStageIds: ['evidence'],
      items: [{ stageId: 'evidence', label: 'Слово', status: 'incorrect' as const, observed: 'сто лет' }] }
    const before = renderToStaticMarkup(<ParentTaskGuide guide={guide} review={review} onStageChoice={async () => {}} />)
    const after = renderToStaticMarkup(<ParentTaskGuide guide={guide} review={review} decisions={[{
      id: 'token:decision', taskId: 'task', action: 'stage-optional', stageId: 'evidence',
      reviewCheckedAt: review.checkedAt, decidedAt: { seconds: 101, nanoseconds: 0 },
    }]} onStageChoice={async () => {}} />)
    expect(before).toContain('Расхождение')
    expect(before).toContain('aria-checked="true"')
    expect(after).toContain('По желанию · не входит в итог')
    expect(after).toContain('aria-checked="false"')
    expect(after).toContain('data-status="ready"')
    expect(after).not.toContain('data-status="needs-fix"')
  })
})
