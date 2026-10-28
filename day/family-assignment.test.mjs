import { describe, expect, it } from 'vitest'
import { familyAssignmentErrors, learnerOriginErrors, familyAssignmentsWithOverlay, familyGuideErrors, familyTestPlacementErrors, mergeFamilyAssignments, planFamilyTestPlacements, projectFamilyAssignment } from './family-assignment.mjs'

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

  it('projects optional mathematics practice into its own subject without disturbing Russian work', () => {
    const math = { ...assignment, id: 'family-math-olympiad', sourceId: 'family-math-olympiad', subjectId: 'math', subjectName: 'Математика',
      learningContext: { kind: 'olympiad', id: 'formulo' }, optional: true }
    expect(familyAssignmentErrors(math, { familyId: math.familyId, childId: math.childId, taskId: math.id })).toEqual([])
    expect(familyAssignmentErrors({ ...math, optional: false }, { familyId: math.familyId, childId: math.childId, taskId: math.id })).not.toEqual([])
    const base = { planRevision: 1, subjects: [{ id: 'russian', tasks: [{ id: 'existing' }] }] }
    const page = mergeFamilyAssignments(base, [assignment, math])
    expect(page.subjects.find(s => s.id === 'math').tasks[0]).toMatchObject({ id: math.id, optional: true, learningContext: math.learningContext })
    expect(page.subjects.find(s => s.id === 'russian').tasks.map(t => t.id)).toEqual(['existing', assignment.id])
    expect(page.changes[0].changedSubjects).toEqual(['russian', 'math'])
    expect(mergeFamilyAssignments(page, [assignment, math]).planRevision).toBe(page.planRevision)
  })

  it('projects a source intake only in an optional olympiad and preserves it across a repeat publish', () => {
    const task = { ...assignment, subjectId: 'math', subjectName: 'Математика', learningContext: { kind: 'olympiad', id: 'o1' }, optional: true, sourceIntake: { kind: 'olympiad-sheet' } }
    const owner = { familyId: task.familyId, childId: task.childId, taskId: task.id }
    expect(familyAssignmentErrors(task, owner)).toEqual([])
    expect(familyAssignmentErrors({ ...task, optional: false }, owner)).not.toEqual([])
    expect(familyAssignmentErrors({ ...task, sourceIntake: { kind: 'other' } }, owner)).not.toEqual([])
    const page = mergeFamilyAssignments({ planRevision: 1, subjects: [] }, [task])
    expect(page.subjects[0].tasks[0].sourceIntake).toEqual({ kind: 'olympiad-sheet' })
    expect(mergeFamilyAssignments(page, [task]).planRevision).toBe(page.planRevision)
  })

  it('accepts only optional quizzes belonging to the same child and context', () => {
    const token = 'q'.repeat(32), context = { kind: 'olympiad', id: 'formulo' }
    const math = { ...assignment, id: 'family-math-olympiad', sourceId: 'family-math-olympiad', subjectId: 'math', subjectName: 'Математика',
      learningContext: context, optional: true, testPlacements: [{ token }] }
    const quiz = { familyId: math.familyId, childId: math.childId, familyOptional: true, learningContext: context }
    expect(familyAssignmentErrors(math, { familyId: math.familyId, childId: math.childId, taskId: math.id })).toEqual([])
    expect(familyTestPlacementErrors(math, new Map([[token, quiz]]))).toEqual([])
    expect(familyTestPlacementErrors(math, new Map([[token, { ...quiz, familyOptional: false }]]))).toEqual([])
    for (const unsafe of [{ ...quiz, childId: 'other' }, { ...quiz, learningContext: { kind: 'course', id: 'formulo' } }]) {
      expect(familyTestPlacementErrors(math, new Map([[token, unsafe]]))).not.toEqual([])
    }
    const quizzes = new Map([[token, quiz]])
    const placements = planFamilyTestPlacements(math, quizzes, {})
    expect(placements).toEqual([{ token, subjectId: 'math', optional: true }])
    expect(planFamilyTestPlacements(math, quizzes, { testPlacements: placements })).toEqual(placements)
    expect(() => planFamilyTestPlacements(math, quizzes, { testPlacements: [{ token, subjectId: 'russian' }] })).toThrow()
  })
})

describe('learner-origin olympiad cards', () => {
  it('preserves source photos in family projection and rejects unrelated or malformed origin', () => {
    const task = { ...assignment, subjectId: 'math', subjectName: 'Математика', learningContext: { kind: 'olympiad', id: 'o1' }, optional: true, learnerOrigin: { intakeTaskId: 'sheet-one', uploadIds: ['photo-12345678901234567890'] } }
    const owner = { familyId: task.familyId, childId: task.childId, taskId: task.id }
    expect(familyAssignmentErrors(task, owner)).toEqual([])
    expect(projectFamilyAssignment(task).learnerOrigin).toEqual(task.learnerOrigin)
    expect(familyAssignmentErrors({ ...task, learningContext: { kind: 'homework', id: 'o1' } }, owner)).not.toEqual([])
    expect(familyAssignmentErrors({ ...task, learnerOrigin: { ...task.learnerOrigin, uploadIds: ['bad'] } }, owner)).not.toEqual([])
    expect(familyAssignmentErrors({ ...task, sourceIntake: { kind: 'olympiad-sheet' } }, owner)).not.toEqual([])
    const intake = { familyId: task.familyId, childId: task.childId, sourceIntake: { kind: 'olympiad-sheet' }, learningContext: task.learningContext, projectionSourceDate: '2026-10-22' }
    const photo = { id: task.learnerOrigin.uploadIds[0], taskId: 'sheet-one', status: 'pending', storage: { state: 'stored', sha256: 'a'.repeat(64) } }
    expect(learnerOriginErrors(task, intake, [photo], '2026-10-22')).toEqual([])
    const crop = { x: 20, y: 30, width: 100, height: 80, sourceWidth: 400, sourceHeight: 240, sourceSha256: 'a'.repeat(64) }
    const cropped = { ...task, learnerOrigin: { ...task.learnerOrigin, crop } }
    expect(familyAssignmentErrors(cropped, owner)).toEqual([])
    expect(learnerOriginErrors(cropped, intake, [photo], '2026-10-22')).toEqual([])
    expect(projectFamilyAssignment(cropped).learnerOrigin.crop).toEqual(crop)
    const contest = { ...cropped, competitionUntil: '2999-01-01T00:00:00.000Z', competitionNumber: 1 }
    expect(familyAssignmentErrors(contest, owner)).toEqual([])
    expect(projectFamilyAssignment(contest).competitionUntil).toEqual(contest.competitionUntil)
    expect(familyAssignmentErrors({ ...contest, learnerOrigin: task.learnerOrigin }, owner)).not.toEqual([])
    expect(learnerOriginErrors(cropped, intake, [{ ...photo, storage: { ...photo.storage, sha256: 'b'.repeat(64) } }], '2026-10-22')).not.toEqual([])
    expect(familyAssignmentErrors({ ...cropped, learnerOrigin: { ...cropped.learnerOrigin, crop: { ...crop, width: 500 } } }, owner)).not.toEqual([])
    expect(familyAssignmentErrors({ ...cropped, learnerOrigin: { ...cropped.learnerOrigin, uploadIds: [photo.id, 'other-12345678901234567890'] } }, owner)).not.toEqual([])
    expect(learnerOriginErrors(task, { ...intake, childId: 'foreign' }, [photo], '2026-10-22')).not.toEqual([])
    expect(learnerOriginErrors(task, intake, [{ ...photo, taskId: 'foreign' }], '2026-10-22')).not.toEqual([])
    expect(learnerOriginErrors(task, intake, [{ ...photo, storage: { state: 'stored', sha256: 'broken' } }], '2026-10-22')).not.toEqual([])
  })
})
