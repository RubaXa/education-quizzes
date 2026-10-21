import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDaySource } from './build.mjs'

const dirs = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
const write = (file, value) => writeFileSync(file, JSON.stringify(value))

function fixture() {
  const local = mkdtempSync(join(tmpdir(), 'edu-two-assignments-'))
  dirs.push(local)
  mkdirSync(join(local, 'diary'))
  const assignment = {
    subjectName: 'Математика', subjectId: 33623635,
    homeworkEntries: [
      { id: 'one', description: 'Геометрия: решить задачи из файла' },
      { id: 'two', description: 'Решать задания из файла' },
    ],
    teacherFiles: [
      { id: 'geometry', title: 'Геометрия.png', url: 'https://example.org/geometry.png' },
      { id: 'ratios', title: 'Пропорции.pdf', url: 'https://example.org/ratios.pdf' },
    ],
  }
  write(join(local, 'diary', 'snapshot-2026-10-13.json'), { complete: true, assignments: [] })
  write(join(local, 'diary', 'snapshot-2026-10-14.json'), { complete: true, fetchedAt: '2026-10-13T12:00:00Z', schedule: [{ subjectName: 'Математика' }], assignments: [assignment] })
  return { local, assignment, source: join(local, 'day-source-2026-10-13.json') }
}

describe('сборка двух МЭШ-заданий с файлами уровня урока', () => {
  it('не копирует оба файла в обе карточки и сохраняет подтверждённое сопоставление при повторе', () => {
    const { local, source } = fixture()
    buildDaySource(local, '2026-10-13')
    const initial = read(source)
    expect(initial.materialLinks['mesh-one']).toBeUndefined()
    expect(initial.materialLinks['mesh-two']).toBeUndefined()
    expect(initial.subjects[0].tasks.every((task) => task.materialStatus.state === 'teacher-attachment-needed')).toBe(true)
    expect(initial.subjects[0].tasks.every((task) => task.sourceOnly === true)).toBe(true)

    initial.materialLinks = {
      'mesh-one': [{ sourceType: 'teacher-attachment', sourceRef: 'mesh-attachment:geometry', url: 'https://example.org/geometry.png' }],
      'mesh-two': [{ sourceType: 'teacher-attachment', sourceRef: 'mesh-attachment:ratios', url: 'https://example.org/ratios.pdf' }],
    }
    write(source, initial)
    buildDaySource(local, '2026-10-13')
    expect(read(source).materialLinks).toEqual(initial.materialLinks)
  })
  it('сбрасывает прежнюю разметку вариантов при изменении записи учителя', () => {
    const { local, assignment, source } = fixture()
    buildDaySource(local, '2026-10-13')
    const old = read(source)
    old.subjects[0].tasks[0].sourceOnly = true
    old.subjects[0].tasks[0].practiceVariants = [{ id: 'mesh-one-v1', title: 'Вариант 1' }, { id: 'mesh-one-v2', title: 'Вариант 2' }]
    old.subjects[0].tasks[0].problems = [{ id: 'mesh-one-p-v1-1', variantId: 'mesh-one-v1', number: 1 }]
    old.subjects[0].tasks[0].materialRequest = { id:'notes-1', state:'open', question:'Прежний вопрос по прежнему условию', photoPrompt:'Фото прежнего материала' }
    write(source, old)
    assignment.homeworkEntries[0].description = 'Решить новый лист учителя'
    write(join(local, 'diary', 'snapshot-2026-10-14.json'), {
      complete: true, fetchedAt: '2026-10-13T13:00:00Z', schedule: [{ subjectName: 'Математика' }], assignments: [assignment],
    })
    buildDaySource(local, '2026-10-13')
    const revised = read(source).subjects[0].tasks[0]
    expect(revised.instructionStatus.state).toBe('needs-review')
    expect(revised.sourceOnly).toBe(true)
    expect(revised.problems).toBeUndefined()
    expect(revised.practiceVariants).toBeUndefined()
    expect(revised.materialRequest).toBeUndefined()
  })
  it('сохраняет явный отказ от source-only режима при неизменной записи', () => {
    const { local, source } = fixture()
    buildDaySource(local, '2026-10-13')
    const current = read(source)
    current.subjects[0].tasks[0].sourceOnly = false
    write(source, current)
    buildDaySource(local, '2026-10-13')
    expect(read(source).subjects[0].tasks[0].sourceOnly).toBe(false)
  })
})

function noticeFixture(description, teacherFiles = []) {
  const local = mkdtempSync(join(tmpdir(), 'edu-mesh-notice-'))
  dirs.push(local)
  mkdirSync(join(local, 'diary'))
  const assignment = { sourceItemId: 'assignment', subjectName: 'Математика', subjectId: 33623635,
    homeworkEntries: [{ id: '352682606', description }], teacherFiles }
  write(join(local, 'diary', 'snapshot-2026-10-13.json'), { complete: true, assignments: [] })
  write(join(local, 'diary', 'snapshot-2026-10-14.json'), { complete: true, fetchedAt: '2026-10-13T12:00:00Z',
    schedule: [{ subjectName: 'Математика' }], assignments: [assignment] })
  return { local, assignment, source: join(local, 'day-source-2026-10-13.json') }
}

describe('информационная запись МЭШ', () => {
  it('сохраняет точное поздравление как non-action и не считает его назначенным ДЗ', () => {
    const { local, source } = noticeFixture('Всем хороших каникул!')
    const built = buildDaySource(local, '2026-10-13')
    const first = read(source)
    expect(built).toMatchObject({ assigned: 0, tasks: 0, added: 0 })
    expect(first.subjects[0].mesh).toBe('Всем хороших каникул!')
    expect(first.subjects[0].tasks).toEqual([])
    expect(first.sourceOnlyEntries).toEqual([{ id: 'mesh-352682606', subjectId: 'math', rawText: 'Всем хороших каникул!',
      kind: 'notice', reason: 'Точная отдельная поздравительная запись МЭШ; в ней нет учебного действия.' }])
    buildDaySource(local, '2026-10-13')
    expect(read(source).sourceOnlyEntries).toEqual(first.sourceOnlyEntries)
  })

  it('оставляет смешанный текст с учебным действием обычным заданием', () => {
    const { local, source } = noticeFixture('Всем хороших каникул! Решить № 5.')
    expect(buildDaySource(local, '2026-10-13')).toMatchObject({ assigned: 1, tasks: 1, added: 1 })
    const built = read(source)
    expect(built.sourceOnlyEntries ?? []).toEqual([])
    expect(built.subjects[0].tasks[0]).toMatchObject({ id: 'mesh-352682606', meshText: 'Всем хороших каникул! Решить № 5.' })
  })

  it('does not classify a greeting with teacher files as a notice or drop the files', () => {
    const { local, source } = noticeFixture('Всем хороших каникул!', [{ id: 'file', title: 'Лист.pdf', url: 'https://example.org/file.pdf' }])
    expect(buildDaySource(local, '2026-10-13')).toMatchObject({ assigned: 1, tasks: 1, added: 1 })
    const built = read(source)
    expect(built.sourceOnlyEntries ?? []).toEqual([])
    expect(built.materialLinks['mesh-352682606']).toEqual([{ title: 'Лист.pdf', url: 'https://example.org/file.pdf',
      sourceType: 'teacher-attachment' }])
  })

  it('reuses the same source ID across notice→action→notice and removes only that notice metadata', () => {
    const { local, source, assignment } = noticeFixture('Всем хороших каникул!')
    buildDaySource(local, '2026-10-13')
    let current = read(source)
    current.sourceOnlyEntries.push({ id: 'mesh-elsewhere', subjectId: 'math', rawText: 'other', reason: 'attachment', targetTaskId: 'mesh-target' })
    write(source, current)
    assignment.homeworkEntries[0].description = 'Решить № 5.'
    assignment.teacherFiles = [{ id: 'task-sheet', title: 'Лист.pdf', url: 'https://example.org/task-sheet.pdf' }]
    write(join(local, 'diary', 'snapshot-2026-10-14.json'), { complete: true, fetchedAt: '2026-10-13T13:00:00Z',
      schedule: [{ subjectName: 'Математика' }], assignments: [assignment] })
    buildDaySource(local, '2026-10-13')
    current = read(source)
    expect(current.subjects[0].tasks.map((task) => task.id)).toEqual(['mesh-352682606'])
    expect(current.materialLinks['mesh-352682606']).toHaveLength(1)
    expect(current.sourceOnlyEntries.map((entry) => entry.id)).toEqual(['mesh-elsewhere'])
    assignment.teacherFiles = []
    assignment.homeworkEntries[0].description = 'Всем хороших каникул!'
    write(join(local, 'diary', 'snapshot-2026-10-14.json'), { complete: true, fetchedAt: '2026-10-13T14:00:00Z',
      schedule: [{ subjectName: 'Математика' }], assignments: [assignment] })
    buildDaySource(local, '2026-10-13')
    current = read(source)
    expect(current.subjects[0].tasks).toEqual([])
    expect(current.sourceOnlyEntries.map((entry) => entry.id)).toEqual(['mesh-elsewhere', 'mesh-352682606'])
  })

  it('drops stale notice metadata when Mesh replaces its source ID', () => {
    const { local, source, assignment } = noticeFixture('Всем хороших каникул!')
    buildDaySource(local, '2026-10-13')
    assignment.homeworkEntries[0] = { id: '352682607', description: 'Всем хороших каникул!' }
    write(join(local, 'diary', 'snapshot-2026-10-14.json'), { complete: true, fetchedAt: '2026-10-13T13:00:00Z',
      schedule: [{ subjectName: 'Математика' }], assignments: [assignment] })
    buildDaySource(local, '2026-10-13')
    expect(read(source).sourceOnlyEntries.map((entry) => entry.id)).toEqual(['mesh-352682607'])
  })
})
