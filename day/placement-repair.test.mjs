import { describe, expect, it } from 'vitest'
import { repairTaskPlacements } from './placement-repair.mjs'

const good = 'a'.repeat(32), old = 'b'.repeat(32)
function page() { return {
  schemaVersion: 1, kind: 'parent', date: '2026-10-09', targetDate: '2026-10-10', boardToken: 'board', studentToken: 'student', planRevision: 7,
  subjects: [{ id: 'history', tasks: [{ id: 'mesh-1', title: 'Прочитать', kind: 'read', testToken: good, status: 'verified' }] }],
  testPlacements: [{ subjectId: 'history', taskId: 'mesh-1', token: old }, { subjectId: 'history', taskId: 'mesh-1', token: good }],
  materialLinks: { 'mesh-1': [{ sourceType: 'teacher-attachment', url: 'https://example.com' }] },
} }
describe('миграция связи теста', () => {
  it('оставляет ровно привязку задания к действующему токену', () => {
    const before = page(), after = repairTaskPlacements(before)
    expect(after.testPlacements).toEqual([before.testPlacements[1]])
    expect(after.subjects).toBe(before.subjects)
    expect(after.materialLinks).toBe(before.materialLinks)
    expect(after.planRevision).toBe(7)
    expect(before.testPlacements).toHaveLength(2)
    expect(repairTaskPlacements(after)).toEqual(after)
  })
  it('отвергает другую несогласованность вместо молчаливого удаления данных', () => {
    const before = page(); before.subjects[0].tasks.push({ id: 'mesh-1', testToken: good })
    expect(() => repairTaskPlacements(before)).toThrow(/Повторяется taskId/)
  })
})
