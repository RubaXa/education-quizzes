import { describe, expect, it } from 'vitest'
import { proposeGradeSnapshot } from './grade-snapshot.mjs'

const report = 'reports/2026-10-16-education-sync/baseline.md'
const previous = { snapshot_id: 'grades:2026-10-15-period-1', observed_at: '2026-10-15', source_report: 'old',
  subjects: [{ id: 'math', name: 'Математика', grades: [[5, 1], [4, 1]], displayed_average: 4.5 }] }
const mesh = { complete: true, fetchedAt: '2026-10-16T06:30:00.000Z',
  marks: [{ subject_name: 'Математика', count: 3, average: 4.67,
    marks: [{ value: 5, weight: 1 }, { value: 4, weight: 1 }, { value: 5, weight: 1 }] }] }

describe('штатное обновление среза оценок', () => {
  it('добавляет только подтверждённую оценку и повторно ничего не меняет', () => {
    const first = proposeGradeSnapshot(previous, mesh, report)
    expect(first.changes).toEqual([{ subject: 'Математика', previous: 4.5, current: 4.67, added: [[5, 1]] }])
    expect(first.proposal.subjects[0].grades).toEqual([[5, 1], [4, 1], [5, 1]])
    const second = proposeGradeSnapshot(first.proposal, mesh, report)
    expect(second.changes).toEqual([])
    expect(second.proposal).toBe(first.proposal)
  })
  it('останавливает потерю, исправление и неполную ленту', () => {
    expect(() => proposeGradeSnapshot(previous, { ...mesh, marks: [{ ...mesh.marks[0], count: 2, average: 5, marks: [{ value: 5, weight: 1 }, { value: 5, weight: 1 }] }] }, report)).toThrow(/изменилась/)
    expect(() => proposeGradeSnapshot(previous, { ...mesh, marks: [{ ...mesh.marks[0], marks: mesh.marks[0].marks.slice(0, 2) }] }, report)).toThrow(/Неполная/)
  })
})
