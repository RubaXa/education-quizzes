// @see ../../docs/modules/reviews/card-generation-policy.md#source-inventory
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DayMaterialLink, DayProblem, ParentTaskGuide } from '@/lib/dayStore'
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
      expect(html).toContain('Загрузить ')
      expect(html).toContain('class="problem-card-upload"')
      expect(html).toContain(`id="${problem.id}"`)
      expect(html).not.toContain(`id="${problem.id}" open=""`)
      expect(html).toContain('Условие № 1')
      expect(html).not.toContain('Оригинал учителя')
      expect(html).not.toContain('Сверь с оригиналом')
      if (tone === 'ready') expect(html).toContain('Не начато')
    }
  })
})

// @see ../../docs/modules/reviews/adaptive-problem-card.md#показ-ученику
describe('stable numbered problem layers', () => {
  const problem = { id: 'math-p3', number: 3, title: 'Найти ошибку', detail: 'Решить', source: 'Лист учителя',
    original: { text: 'Дано: DF = 9,3 см. Найти ошибку.', attachmentRef: 'sheet' },
    support: { skill: 'Длина отрезка', state: 'unknown', evidence: 'Сверенный лист', evidenceRefs: ['sheet'],
      facts: [{ label: 'DE', value: '6,4 см' }, { label: 'EF', value: '3,9 см' }, { label: 'DF', value: '9,3 см' }],
      find: 'Ошибка в условии', firstQuestion: 'Что показывает чертёж?', revision: 1 },
  } as DayProblem
  const guide = { kind: 'worked-solution', presentation: 'math-route', overview: 'Разбор', stages: [] } as ParentTaskGuide

  it('shows the actual cropped original beside a separate transcription when text exists', () => {
    const crop = { x: 90, y: 130, width: 820, height: 128, sourceWidth: 1871, sourceHeight: 1323, sourceSha256: 'teacher-sha' }
    const numbered = { ...problem, original: { text: '№ 3. Дано: DF = 9,3 см.', attachmentRef: 'sheet', crop } } as DayProblem
    const links = [{ sourceType: 'teacher-attachment', sourceRef: 'sheet', sourceSha256: 'teacher-sha', url: 'https://example.org/sheet.png' }] as DayMaterialLink[]
    const html = renderToStaticMarkup(<ProblemTaskCard problem={numbered} state={{ tone: 'ready', label: 'Не начато' }}
      links={links} parent guide={guide} uploads={[]} helpAccess="ready" onPhotos={() => undefined} />)
    expect(html).toContain('education-image-crop')
    expect(html).toContain('Открыть фрагмент оригинального листа')
    expect(html).toContain('Условие текстом')
    expect(html).not.toContain('Оригинал · открыть крупно')
  })

  it('does not show a photo upload action to the parent', () => {
    const html = renderToStaticMarkup(<ProblemTaskCard problem={problem} state={{ tone: 'ready', label: 'Не начато' }}
      links={[]} parent guide={guide} uploads={[]} helpAccess="ready" onPhotos={() => undefined} />)
    expect(html).not.toContain('Загрузить решение')
    expect(html).not.toContain('problem-card-upload')
  })

  it('shows each labeled quantity in its own fact tile without rewriting the source', () => {
    const diagram = { ...problem, support: { ...problem.support!, facts: [
      { label: 'Из условия', value: 'Птицы: 20; животные: 10; автомобили: 60' },
    ], find: 'Построить круговую диаграмму коллекции' } } as DayProblem
    const html = renderToStaticMarkup(<ProblemTaskCard problem={diagram} state={{ tone: 'ready', label: 'Не начато' }}
      links={[]} parent guide={guide} uploads={[]} helpAccess="ready" onPhotos={() => undefined} />)
    expect(html).toContain('<strong>20</strong><small>Птицы</small>')
    expect(html).toContain('<strong>10</strong><small>Животные</small>')
    expect(html).toContain('<strong>60</strong><small>Автомобили</small>')
    expect(html).not.toContain('<strong>Птицы: 20; животные: 10; автомобили: 60</strong>')
    expect(diagram.support?.facts).toEqual([{ label: 'Из условия', value: 'Птицы: 20; животные: 10; автомобили: 60' }])
    const ambiguous = { ...diagram, support: { ...diagram.support!, facts: [
      { label: 'Из условия', value: 'Время: 12:30; место: школа' },
    ] } } as DayProblem
    const ambiguousHtml = renderToStaticMarkup(<ProblemTaskCard problem={ambiguous} state={{ tone: 'ready', label: 'Не начато' }}
      links={[]} parent guide={guide} uploads={[]} helpAccess="ready" onPhotos={() => undefined} />)
    expect(ambiguousHtml).toContain('<strong>Время: 12:30; место: школа</strong><small>Из условия</small>')
  })

  it('keeps the colored given/find layer on the parent math route', () => {
    const html = renderToStaticMarkup(<ProblemTaskCard problem={problem} state={{ tone: 'ready', label: 'Не начато' }}
      links={[]} parent guide={guide} uploads={[]} helpAccess="ready" onPhotos={() => undefined} />)
    expect(html).toContain('aria-label="Дано"')
    expect(html).toContain('Ошибка в условии')
    expect(html).toContain('class="problem-statement-facts"')
    expect(html).toContain('class="problem-statement-find"')
    expect(html).toContain('Условие текстом')
    expect(html).toContain('Ход решения')
    expect(html).not.toContain('class="problem-statement-provenance"')
  })

  it('does not repeat a number already present in the teacher transcript', () => {
    const numbered = { ...problem, original: { ...problem.original, text: '№ 3. Дано: DF = 9,3 см. Найти ошибку.' } } as DayProblem
    const html = renderToStaticMarkup(<ProblemTaskCard problem={numbered} state={{ tone: 'ready', label: 'Не начато' }}
      links={[]} parent guide={guide} uploads={[]} helpAccess="ready" onPhotos={() => undefined} />)
    expect(html).toContain('№ 3. Дано: DF')
    expect(html).not.toContain('№ 3.</b> № 3.')
  })

  it('shows a compact source disclosure until the parent opens it', () => {
    const html = renderToStaticMarkup(<ProblemTaskCard problem={problem} state={{ tone: 'ready', label: 'Не начато' }}
      links={[]} parent guide={guide} uploads={[]} helpAccess="ready" onPhotos={() => undefined} />)
    expect(html).toContain('aria-label="Происхождение не проверено. Показать происхождение задачи"')
    expect(html).toContain('aria-expanded="false"')
    expect(html.indexOf('problem-card-source-trigger')).toBeLessThan(html.indexOf('problem-statement-original'))
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
