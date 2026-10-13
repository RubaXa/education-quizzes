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

    initial.materialLinks = {
      'mesh-one': [{ sourceType: 'teacher-attachment', sourceRef: 'mesh-attachment:geometry', url: 'https://example.org/geometry.png' }],
      'mesh-two': [{ sourceType: 'teacher-attachment', sourceRef: 'mesh-attachment:ratios', url: 'https://example.org/ratios.pdf' }],
    }
    write(source, initial)
    buildDaySource(local, '2026-10-13')
    expect(read(source).materialLinks).toEqual(initial.materialLinks)
  })
})
