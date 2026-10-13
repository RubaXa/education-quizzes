import { describe, expect, it } from 'vitest'
import { publicPageSubjects, publicProblem } from './public-projection.mjs'

describe('публичная проекция страниц дня', () => {
  it('удаляет родительский ориентир и исследование из задания и номера', () => {
    const input = [{ id: 'math', tasks: [{ id: 'mesh-1', parentGuide: { stages: [] }, sourceResearch: { title: 'internal' },
      problems: [{ id: 'problem-1', title: '№ 1', parentGuide: { stages: [] }, sourceResearch: { title: 'internal' } }] }] }]
    const output = publicPageSubjects(input)
    expect(output).toEqual([{ id: 'math', tasks: [{ id: 'mesh-1', problems: [{ id: 'problem-1', title: '№ 1' }] }] }])
    expect(input[0].tasks[0].parentGuide).toBeDefined()
  })

  it('сохраняет публичное условие при обновлении поддержки номера', () => {
    expect(publicProblem({ id: 'n1', original: { text: 'Дано' }, sourceResearch: { title: 'internal' }, parentGuide: { stages: [] } }))
      .toEqual({ id: 'n1', original: { text: 'Дано' } })
  })
})
