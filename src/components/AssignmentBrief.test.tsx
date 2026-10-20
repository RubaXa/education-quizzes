// @see ../../docs/modules/reviews/problem-card-design-decisions.md#flat-numbered-sheet
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DayTask } from '@/lib/dayStore'
import AssignmentBrief from './AssignmentBrief'

const task = { id: 'mesh-sheet', title: 'Подготовиться к самостоятельной',
  detail: 'Подготовиться по двум вариантам', meshText: 'Подготовиться к сам.работе по теме «Диаграммы» (файл приложен)',
} as DayTask

describe('teacher wording in a numbered sheet', () => {
  it('keeps the exact instruction accessible in one collapsed disclosure', () => {
    const html = renderToStaticMarkup(<AssignmentBrief task={task} compact />)
    expect(html).toContain('<details class="day-assignment-brief day-assignment-brief-compact">')
    expect(html).toContain('<summary>Как задано учителем</summary>')
    expect(html).toContain(task.meshText)
    expect(html).not.toContain('Задание учителя</strong>')
  })

  it('keeps the existing visible instruction for an ordinary task', () => {
    const html = renderToStaticMarkup(<AssignmentBrief task={task} />)
    expect(html).toContain('Задание учителя</strong>')
    expect(html).toContain(task.meshText)
    expect(html).not.toContain('<details')
  })

  it('labels family-origin preparation truthfully and does not claim a MESH or textbook source', () => {
    const familyTask = { ...task, id: 'family-essay', title: 'Подготовка к сочинению', meshText: undefined,
      detail: 'Это подготовка по просьбе родителя; точная тема школьного сочинения пока неизвестна.',
      familyOrigin: { sourceSystem: 'family', sourceId: 'family-essay', sourceRevision: 1 } } as DayTask
    const html = renderToStaticMarkup(<AssignmentBrief task={familyTask} materialLinks={[{ sourceType: 'textbook-page' } as never]} />)
    expect(html).toContain('<strong>Подготовка Education</strong><span>По просьбе родителя</span>')
    expect(html).toContain(familyTask.detail)
    expect(html).not.toContain('Задание учителя')
    expect(html).not.toContain('МЭШ')
    expect(html).not.toContain('Страницы учебника')
  })

  it('uses parent wording in the compact family disclosure', () => {
    const familyTask = { ...task, id: 'family-essay', title: 'Подготовка к сочинению', meshText: undefined,
      detail: 'Наблюдай, составь план, напиши свою версию.',
      familyOrigin: { sourceSystem: 'family', sourceId: 'family-essay', sourceRevision: 1 } } as DayTask
    const html = renderToStaticMarkup(<AssignmentBrief task={familyTask} compact />)
    expect(html).toContain('<summary>Как назначено родителем</summary>')
    expect(html).not.toContain('Как задано учителем')
    expect(html).not.toContain('МЭШ')
  })
})
