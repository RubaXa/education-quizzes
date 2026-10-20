import { describe, expect, it } from 'vitest'
import { familyAssignmentErrors, familyAssignmentsWithOverlay, familyGuideErrors, mergeFamilyAssignments, projectFamilyAssignment } from './family-assignment.mjs'

const assignment = {
  id: 'family-russian-essay-2026-10-23', sourceSystem: 'family', sourceId: 'family-russian-essay-2026-10-23',
  sourceRevision: 1, familyId: 'family-1', childId: 'child-1', subjectId: 'russian', dayProjectionVersion: 1, dueDate: '2026-10-23', title: 'Подготовка к сочинению',
  originalText: 'Выбери одну тему, запиши наблюдения, составь план и напиши первую версию.',
  steps: ['Наблюдай', 'Планируй', 'Пиши'], submission: { buttonLabel: 'Прикрепить сочинение', lead: 'Прикрепи версию.', photo: 'Все страницы текста.' },
  cardPattern: 'composition', cardPolicyVersion: 1, outputKind: 'text-structure',
  publication: 'active', evidence: 'photo', materialIds: [],
}

describe('family-origin day assignments', () => {
  it('plans dashboards with the new canonical task overlay before the transaction writes it', () => {
    expect(familyAssignmentsWithOverlay([], assignment)).toEqual([assignment])
    expect(familyAssignmentsWithOverlay([{ ...assignment, title: 'Старая ревизия' }], assignment)).toEqual([assignment])
  })

  it('validates a scoped family task and rejects a forged source kind', () => {
    expect(familyAssignmentErrors(assignment, { familyId: 'family-1', childId: 'child-1', taskId: assignment.id })).toEqual([])
    expect(familyAssignmentErrors({ ...assignment, sourceSystem: 'mesh' }, { familyId: 'family-1', childId: 'child-1', taskId: assignment.id })).toContain('Источник должен быть семейным и иметь стабильную ревизию.')
  })

  it('projects a written card with explicit parent provenance and preserves its stable upload ID', () => {
    const task = projectFamilyAssignment(assignment)
    expect(task).toMatchObject({ id: assignment.id, kind: 'written', source: 'Education · назначено родителем', familyOrigin: { sourceSystem: 'family' }, dueDate: '2026-10-23' })
  })

  it('accepts only a private, source-bound structure guide without a sample answer', () => {
    const source = { kind: 'family', label: 'Подготовка Education', ref: assignment.id, excerpt: 'Выбери одну тему' }
    const guide = { kind: 'text-structure', presentation: 'learning-route', pattern: 'composition', revision: 1, overview: 'Сначала замысел.', stages: [
      { id: 'idea', title: 'Замысел', expected: 'Выбранное впечатление', hintPreview: 'Что хочешь передать?', revealPreview: 'Сформулируй замысел.', reviewLabels: ['Замысел'], source },
      { id: 'support', title: 'Детали', expected: 'Связанные наблюдения', hintPreview: 'Какая деталь важна?', revealPreview: 'Проверь заметки.', reviewLabels: ['Наблюдения'], source },
      { id: 'coherence', title: 'План', expected: 'Связный порядок', hintPreview: 'Каков порядок?', revealPreview: 'Проверь план.', reviewLabels: ['Построение'], source },
      { id: 'language', title: 'Речь', expected: 'Точные слова', hintPreview: 'Что уточнить?', revealPreview: 'Перечитай текст.', reviewLabels: ['Речь'], source },
    ] }
    expect(familyGuideErrors(guide, assignment)).toEqual([])
    expect(familyGuideErrors({ ...guide, stages: guide.stages.map((stage) => ({ ...stage, answer: 'Готовое сочинение' })) }, assignment)).toHaveLength(1)
    expect(projectFamilyAssignment({ ...assignment, parentGuide: guide })).not.toHaveProperty('parentGuide')
  })

  it('adds the assignment without changing existing MESH tasks and is idempotent', () => {
    const page = { planRevision: 7, changes: [], subjects: [{ id: 'russian', name: 'Русский язык', tasks: [{ id: 'mesh-1', title: 'Упражнение', detail: 'Упр. 1', kind: 'written', status: 'unknown', source: 'МЭШ' }] }], taskIds: ['mesh-1'] }
    const once = mergeFamilyAssignments(page, [assignment])
    const twice = mergeFamilyAssignments(once, [assignment])
    expect(once.subjects[0].tasks.map(({ id }) => id)).toEqual(['mesh-1', assignment.id])
    expect(twice.subjects[0].tasks.map(({ id }) => id)).toEqual(['mesh-1', assignment.id])
    expect(twice.taskIds).toEqual(['mesh-1', assignment.id])
    expect(once.planRevision).toBe(8)
    expect(twice.planRevision).toBe(8)
    expect(once.changes[0].added).toEqual([assignment.id])
    expect(twice.changes).toEqual(once.changes)
    once.subjects[0].tasks[1].status = 'verified'
    expect(mergeFamilyAssignments(once, [assignment]).subjects[0].tasks[1].status).toBe('verified')
    const revised = mergeFamilyAssignments(once, [{ ...assignment, sourceRevision: 2, title: 'Новая формулировка' }])
    expect(revised.planRevision).toBe(9)
    expect(revised.changes[0].changed).toEqual([assignment.id])
    expect(mergeFamilyAssignments(revised, [{ ...assignment, sourceRevision: 2, title: 'Новая формулировка' }]).planRevision).toBe(9)
  })
})
