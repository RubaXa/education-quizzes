import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildDayDashboardIndex } from './dashboard-index.mjs'
import { familyAssignmentErrors, familyGuideErrors, mergeFamilyAssignments } from './family-assignment.mjs'
import { assertPublishedPageAligned, sourcePlanFingerprint } from './pipeline-contract.mjs'
import { publicPageSubjects } from './public-projection.mjs'

const familyId = 'family-1'
const childId = 'child-1'
const task = {
  id: 'family-russian-essay-2026-10-23', familyId, childId, subjectId: 'russian',
  sourceSystem: 'family', sourceId: 'family-russian-essay-2026-10-23', sourceRevision: 1,
  dayProjectionVersion: 1,
  dueDate: '2026-10-23', title: 'Подготовка к сочинению',
  originalText: 'Выбери тему, запиши наблюдения, составь план и напиши первую версию.',
  studentText: 'Выбери тему, понаблюдай, составь план и напиши первую версию.',
  steps: ['Наблюдай', 'Планируй', 'Пиши'],
  cardPattern: 'composition', cardPolicyVersion: 1, outputKind: 'text-structure',
  submission: { buttonLabel: 'Прикрепить сочинение', lead: 'Прикрепи первую версию.', photo: 'Сфотографируй все страницы.' },
  publication: 'active', evidence: 'photo', materialIds: [],
}

const guide = {
  kind: 'text-structure', presentation: 'learning-route', pattern: 'composition', revision: 1,
  overview: 'Планирование и первая версия сочинения.',
  stages: [
    { id: 'idea', title: 'Замысел', expected: 'Выбранное впечатление.', hintPreview: 'Что хочешь передать?',
      revealPreview: 'Сформулируй замысел.', reviewLabels: ['Замысел'], source: { kind: 'family', ref: task.id, label: 'Текст задания', excerpt: 'Выбери тему' } },
    { id: 'support', title: 'Детали', expected: 'Связанные наблюдения.', hintPreview: 'Какая деталь важна?',
      revealPreview: 'Проверь заметки.', reviewLabels: ['Наблюдения'], source: { kind: 'family', ref: task.id, label: 'Текст задания', excerpt: 'запиши наблюдения' } },
    { id: 'coherence', title: 'План', expected: 'Связный порядок.', hintPreview: 'Каков порядок?',
      revealPreview: 'Проверь план.', reviewLabels: ['Построение'], source: { kind: 'family', ref: task.id, label: 'Текст задания', excerpt: 'составь план' } },
    { id: 'language', title: 'Речь', expected: 'Точные слова.', hintPreview: 'Что уточнить?',
      revealPreview: 'Перечитай текст.', reviewLabels: ['Речь'], source: { kind: 'family', ref: task.id, label: 'Текст задания', excerpt: 'напиши первую версию' } },
  ],
}

describe('family assignment privacy and publication boundaries', () => {
  it('accepts only the confirmed owner and a family-origin source; parent guidance is separate', () => {
    expect(familyAssignmentErrors(task, { familyId, childId, taskId: task.id })).toEqual([])
    expect(familyAssignmentErrors({ ...task, familyId: 'other-family' }, { familyId, childId, taskId: task.id })).not.toEqual([])
    expect(familyAssignmentErrors({ ...task, sourceSystem: 'mesh' }, { familyId, childId, taskId: task.id })).not.toEqual([])
    expect(familyGuideErrors(guide, task)).toEqual([])
    expect(familyGuideErrors({ ...guide, stages: [{ ...guide.stages[0], answer: 'Готовый ответ' }, guide.stages[1]] }, task)).not.toEqual([])
  })

  it('keeps the canonical Friday task on the Thursday target page for both roles and Friday homework routing', () => {
    const local = mkdtempSync(resolve(tmpdir(), 'education-family-boundary-'))
    try {
      mkdirSync(resolve(local, 'diary'))
      for (const date of ['2026-10-22', '2026-10-23']) {
        writeFileSync(resolve(local, 'diary', `snapshot-${date}.json`), JSON.stringify({ complete: true, date,
          fetchedAt: `${date}T08:00:00Z`, schedule: date === '2026-10-23' ? [{ subject_name: 'Русский язык', start_at: '09:00', finish_at: '09:45' }] : [], assignments: [] }))
      }
      writeFileSync(resolve(local, 'day-source-2026-10-22.json'), JSON.stringify({ targetDate: task.dueDate, subjects: [] }))
      const links = { '2026-10-22': { student: 'student-22', parent: 'parent-22' } }
      for (const role of ['student', 'parent']) {
        const index = buildDayDashboardIndex(local, links, role, new Date('2026-10-20T12:00:00Z'), null, [task])
        const friday = index.days.find((day) => day.date === task.dueDate)
        expect(friday.homeworkDayToken).toBe(`${role}-22`)
        expect(friday.homework).toContainEqual({ subject: 'Русский язык', text: task.title })

        const source = { targetDate: task.dueDate, subjects: [{ id: 'russian', name: 'Русский язык', icon: '✍',
          tasks: [{ id: 'mesh-russian-1', title: 'Упражнение 1', detail: 'Упр. 1', kind: 'written', status: 'unknown', source: 'МЭШ', meshText: 'Упр. 1' }] }] }
        const base = { schemaVersion: 1, kind: role, familyId, childId, date: '2026-10-22', targetDate: task.dueDate,
          boardToken: `${role}-board`, taskIds: ['mesh-russian-1'], sourcePlanFingerprint: sourcePlanFingerprint(source),
          subjects: publicPageSubjects(source.subjects) }
        const page = mergeFamilyAssignments(base, [task])
        page.subjects = publicPageSubjects(page.subjects)
        if (role === 'parent') page.studentToken = 'student-22'
        expect(() => assertPublishedPageAligned(source, page, role, [task])).not.toThrow()
        const essay = page.subjects.flatMap((subject) => subject.tasks).find((item) => item.id === task.id)
        expect(essay).toMatchObject({ id: task.id, source: 'Education · назначено родителем', familyOrigin: { sourceSystem: 'family', sourceId: task.id, sourceRevision: 1 } })
        expect(page.taskIds).toContain(task.id)
        expect(essay.parentGuide).toBeUndefined()
        expect(essay.answer).toBeUndefined()
      }
    } finally { rmSync(local, { recursive: true, force: true }) }
  })

  it('ignores unrelated family tasks unless the official day projection marker is present', () => {
    const local = mkdtempSync(resolve(tmpdir(), 'education-family-unprojected-'))
    try {
      mkdirSync(resolve(local, 'diary'))
      writeFileSync(resolve(local, 'diary', 'snapshot-2026-10-23.json'), JSON.stringify({ complete: true, date: '2026-10-23', schedule: [], assignments: [] }))
      writeFileSync(resolve(local, 'day-source-2026-10-22.json'), JSON.stringify({ targetDate: '2026-10-23', subjects: [] }))
      const links = { '2026-10-22': { student: 'student-22', parent: 'parent-22' } }
      const unrelated = { ...task, dayProjectionVersion: undefined, subjectId: 'math', title: 'Несвязанная семейная задача' }
      for (const role of ['student', 'parent']) {
        const index = buildDayDashboardIndex(local, links, role, new Date('2026-10-20T12:00:00Z'), null, [unrelated])
        expect(index.days.find((day) => day.date === task.dueDate)?.homeworkDayToken).toBe(`${role}-22`)
        expect(index.days.find((day) => day.date === task.dueDate)?.homework ?? []).toEqual([])
      }
      expect(familyAssignmentErrors(unrelated, { familyId, childId, taskId: task.id })).toContain('Для страницы дня требуется явная версия проекции семейного назначения.')
    } finally { rmSync(local, { recursive: true, force: true }) }
  })

  it('strips any accidental private guide from the public task projection', () => {
    const page = mergeFamilyAssignments({ subjects: [], taskIds: [] }, [{ ...task, parentGuide: guide }])
    const projected = publicPageSubjects(page.subjects)
    const learnerTask = projected.flatMap((subject) => subject.tasks).find((item) => item.id === task.id)
    expect(learnerTask.parentGuide).toBeUndefined()
    expect(learnerTask.familyOrigin).toMatchObject({ sourceSystem: 'family', sourceId: task.id })
  })

  it('preserves stable IDs and learner state for the same revision, then projects a newer revision', () => {
    const initial = mergeFamilyAssignments({ subjects: [], taskIds: [] }, [task])
    initial.subjects[0].tasks[0].status = 'reported-complete'
    initial.subjects[0].tasks[0].attempts = [{ id: 'upload-1' }]
    const repeated = mergeFamilyAssignments(initial, [task])
    expect(repeated.subjects[0].tasks[0]).toMatchObject({ id: task.id, status: 'reported-complete', attempts: [{ id: 'upload-1' }] })
    const revised = mergeFamilyAssignments(repeated, [{ ...task, sourceRevision: 2, title: 'Обновлённая подготовка' }])
    expect(revised.subjects[0].tasks).toHaveLength(1)
    expect(revised.subjects[0].tasks[0]).toMatchObject({ id: task.id, title: 'Обновлённая подготовка', familyOrigin: { sourceRevision: 2 }, status: 'unknown' })
    expect(revised.taskIds).toEqual([task.id])
  })
})
