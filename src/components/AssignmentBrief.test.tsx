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
})
