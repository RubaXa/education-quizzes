import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncDiary } from './sync.mjs'
import { MeshDiaryAdapter } from '../adapters/mesh.mjs'

const directories = []
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const newDirectory = () => { const dir = mkdtempSync(join(tmpdir(), 'petr-diary-')); directories.push(dir); return dir }
const lesson = { id: 42, start_at: '2026-10-15T08:30:00Z', subject_id: 7, subject_name: 'Математика', homework: { total_count: 0, descriptions: [] } }
const detail = { lesson_homeworks: [{ homework_id: 99, homework: 'Решить № 4.' }] }
const adapter = (getLessonDetails) => {
  const instance = Object.create(MeshDiaryAdapter.prototype)
  instance.scheduleCache = new Map()
  instance.getSchedule = async () => [lesson]
  instance.getLessonDetails = getLessonDetails
  return instance
}

describe('полнота снимка МЭШ', () => {
  it('сохраняет назначение из подробной карточки даже при пустой краткой строке', async () => {
    const assignments = await adapter(async () => detail).getAssignments('2026-10-15')
    expect(assignments).toHaveLength(1)
    expect(assignments[0].homeworkEntries[0].description).toBe('Решить № 4.')
  })

  it('не запрашивает карточку урока для события календаря без предмета и ДЗ', async () => {
    const mesh = adapter(async (event) => {
      if (event.source === 'OLYMPIAD') throw new Error('API 500')
      return detail
    })
    mesh.getSchedule = async () => [
      { id: 17, start_at: '2026-10-15T08:00:00Z', finish_at: '2026-10-15T09:00:00Z', source: 'OLYMPIAD' },
      lesson,
    ]
    const assignments = await mesh.getAssignments('2026-10-15')
    expect(assignments).toHaveLength(1)
    expect(assignments[0].sourceItemId).toBe('42')
  })

  it('не заменяет полный снимок, если подробная карточка урока недоступна', async () => {
    const dataDir = newDirectory()
    const mesh = {
      getProfile: async () => ({ profile: { id: 1 }, children: [] }),
      getSchedule: async () => [lesson],
      getMarks: async () => [],
      getAssignments: () => adapter(async () => { throw new Error('network') }).getAssignments('2026-10-15'),
    }
    const result = await syncDiary({ adapter: mesh, dataDir, date: '2026-10-15' })
    expect(result.complete).toBe(false)
    expect(result.errors.assignments).toBe('INCOMPLETE_DETAIL')
    expect(result.changesSincePrevious.baseline).toBe(true)
    expect(() => readFileSync(join(dataDir, 'snapshot-2026-10-15.json'))).toThrow()
  })
})

it('collects recent points separately without changing the counted journal; feed failure preserves the last complete snapshot', async () => {
  const dataDir = newDirectory()
  const mesh = { getProfile: async () => ({ children: [{}] }), getSchedule: async () => [], getAssignments: async () => [],
    getMarks: async () => [{ subject_id: 7, subject_name: 'Математика', average: '4.60', count: 13, marks: [{ id: 1, value: 5 }] }],
    getMarkFeed: async () => [{ id: 2, subject_id: 7, value: 2, is_point: true, comment: 'Нет домашней работы' }] }
  const result = await syncDiary({ adapter: mesh, dataDir, date: '2026-11-16' })
  expect(result.complete).toBe(true)
  expect(result.markFeedScope).toBe('recent-not-date-filtered')
  expect(result.marks[0]).toMatchObject({ average: '4.60', count: 13, marks: [{ id: 1, value: 5 }], recentMarks: [{ id: 2 }] })
  mesh.getMarkFeed = async () => { throw new Error('API 500') }
  const failed = await syncDiary({ adapter: mesh, dataDir, date: '2026-11-16' })
  expect(failed.complete).toBe(false)
  expect(JSON.parse(readFileSync(join(dataDir, 'snapshot-2026-11-16.json'))).fetchedAt).toBe(result.fetchedAt)
})
