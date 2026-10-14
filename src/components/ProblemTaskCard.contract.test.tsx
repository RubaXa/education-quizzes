// @see ../../docs/product/card-generation-policy.md#source-inventory
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DayProblem, ParentTaskGuide } from '@/lib/dayStore'
import type { DayGuidance } from '@/lib/dayGuidance'
import ProblemTaskCard from './ProblemTaskCard'

describe('one upload action per numbered problem', () => {
  it('keeps the upload control on the second variant and after a completed review', () => {
    for (const [variantId, tone] of [['mesh-1-v1', 'ready'], ['mesh-1-v2', 'verified']] as const) {
      const problem = { id: `mesh-1-p-${variantId}-1`, number: 1, variantId,
        title: 'Задача', detail: 'Решить', source: 'Лист учителя',
        original: { text: '№ 1. Решить задачу.', attachmentRef: 'mesh-attachment:sheet#1' },
      } as DayProblem
      const html = renderToStaticMarkup(<ProblemTaskCard problem={problem}
        state={{ tone, label: tone === 'verified' ? 'Подтверждено' : 'Не начато' }}
        links={[]} parent={false} uploads={[]} helpAccess="ready" onPhotos={() => undefined} />)
      expect(html).toContain('Добавить фото')
      expect(html).toContain(`id="${problem.id}"`)
      expect(html).not.toContain(`id="${problem.id}" open=""`)
      expect(html).toContain('Условие № 1')
      expect(html).not.toContain('Оригинал учителя')
      expect(html).not.toContain('Сверь с оригиналом')
      if (tone === 'ready') expect(html).toContain('Не начато')
    }
  })
})

// @see ../../docs/product/adaptive-problem-card.md#показ-ученику
describe('stable numbered problem layers', () => {
  const problem = { id: 'math-p3', number: 3, title: 'Найти ошибку', detail: 'Решить', source: 'Лист учителя',
    original: { text: 'Дано: DF = 9,3 см. Найти ошибку.', attachmentRef: 'sheet' },
    support: { skill: 'Длина отрезка', state: 'unknown', evidence: 'Сверенный лист', evidenceRefs: ['sheet'],
      facts: [{ label: 'DE', value: '6,4 см' }, { label: 'EF', value: '3,9 см' }, { label: 'DF', value: '9,3 см' }],
      find: 'Ошибка в условии', firstQuestion: 'Что показывает чертёж?', revision: 1 },
  } as DayProblem
  const guide = { kind: 'worked-solution', presentation: 'math-route', overview: 'Разбор', stages: [] } as ParentTaskGuide

  it('keeps the colored given/find layer on the parent math route', () => {
    const html = renderToStaticMarkup(<ProblemTaskCard problem={problem} state={{ tone: 'ready', label: 'Не начато' }}
      links={[]} parent guide={guide} uploads={[]} helpAccess="ready" onPhotos={() => undefined} />)
    expect(html).toContain('aria-label="Дано"')
    expect(html).toContain('Ошибка в условии')
    expect(html).toContain('class="problem-statement-facts"')
    expect(html).toContain('class="problem-statement-find"')
    expect(html).toContain('Условие текстом')
    expect(html).toContain('Разбор')
  })

  it('shows only a compact source icon until the parent opens it', () => {
    const html = renderToStaticMarkup(<ProblemTaskCard problem={problem} state={{ tone: 'ready', label: 'Не начато' }}
      links={[]} parent guide={guide} uploads={[]} helpAccess="ready" onPhotos={() => undefined} />)
    expect(html).toContain('aria-label="Происхождение не проверено. Показать происхождение задачи"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('class="problem-statement-parent-source"')
    expect(html).not.toContain('Поиск более раннего источника не записан')
  })

  it('uses the same route slot but sends the student only the selected stage text', () => {
    const privateStep = { id: 'reason', title: 'Связь отрезков', expected: 'ЗАКРЫТОЕ РЕШЕНИЕ',
      hintPreview: 'Сравни длины на рисунке.', revealPreview: 'ЗАКРЫТЫЙ ШАГ',
      source: { label: 'Сверенный лист' } }
    const privateGuide = { kind: 'worked-solution', presentation: 'math-route', overview: 'Разбор',
      stages: [privateStep] } as ParentTaskGuide
    const hint = { id: 'sent-hint', taskId: problem.id, stageId: 'reason', stageIndex: 0,
      level: 'hint', text: 'Сравни длины на рисунке.', guideRevision: 1,
      actorPersonId: 'parent', createdAt: null } as DayGuidance
    const common = { problem, state: { tone: 'ready', label: 'Не начато' } as const,
      links: [], guide: privateGuide, uploads: [], helpAccess: 'ready' as const,
      onPhotos: () => undefined }
    const before = renderToStaticMarkup(<ProblemTaskCard {...common} parent={false} guidance={[]} />)
    const student = renderToStaticMarkup(<ProblemTaskCard {...common} parent={false} guidance={[hint]} />)
    const parent = renderToStaticMarkup(<ProblemTaskCard {...common} parent guidance={[hint]} />)
    expect(before).not.toContain('class="day-task-guidance')
    expect(student).toContain('day-task-guidance day-parent-guide day-parent-learning-route')
    expect(parent).toContain('day-parent-guide day-parent-learning-route')
    expect(student.indexOf('Как читать условие')).toBeLessThan(student.indexOf('aria-label="Разбор от родителя"'))
    expect(parent.indexOf('Как читать условие')).toBeLessThan(parent.indexOf('aria-label="Разбор решения для родителя"'))
    expect(student).toContain('Сравни длины на рисунке.')
    expect(student).toContain('Подсказка')
    expect(student).not.toContain('ЗАКРЫТОЕ РЕШЕНИЕ')
    expect(student).not.toContain('ЗАКРЫТЫЙ ШАГ')
    expect(parent).toContain('ЗАКРЫТОЕ РЕШЕНИЕ')
  })
})
