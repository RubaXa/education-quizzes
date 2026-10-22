import { describe, expect, it } from 'vitest'
import { proposeGradeSnapshot } from './grade-snapshot.mjs'

const report = 'reports/2026-10-16-education-sync/baseline.md'
const previous = { snapshot_id: 'grades:2026-10-15-period-1', observed_at: '2026-10-15', source_report: 'old',
  working_threshold: 4.8, working_threshold_status: 'conditional; not a confirmed school rule',
  subjects: [{ id: 'math', name: 'Математика', grades: [[5, 1], [4, 1]], displayed_average: 4.5, app_more_fives: 9 }] }
const mesh = { complete: true, fetchedAt: '2026-10-16T06:30:00.000Z',
  marks: [{ subject_name: 'Математика', count: 3, average: 4.67,
    marks: [{ value: 5, weight: 1 }, { value: 4, weight: 1 }, { value: 5, weight: 1 }] }] }

describe('штатное обновление среза оценок', () => {
  it('добавляет только подтверждённую оценку и повторно ничего не меняет', () => {
    const first = proposeGradeSnapshot(previous, mesh, report)
    expect(first.changes).toEqual([{ subject: 'Математика', previous: 4.5, current: 4.67, added: [[5, 1]],
      previous_app_more_fives: 9, app_more_fives: 2 }])
    expect(first.proposal.subjects[0].grades).toEqual([[5, 1], [4, 1], [5, 1]])
    expect(first.proposal.subjects[0].app_more_fives).toBe(2)
    const second = proposeGradeSnapshot(first.proposal, mesh, report)
    expect(second.changes).toEqual([])
    expect(second.proposal).toBe(first.proposal)
  })
  it('останавливает потерю, исправление и неполную ленту', () => {
    expect(() => proposeGradeSnapshot(previous, { ...mesh, marks: [{ ...mesh.marks[0], count: 2, average: 5, marks: [{ value: 5, weight: 1 }, { value: 5, weight: 1 }] }] }, report)).toThrow(/изменилась/)
    expect(() => proposeGradeSnapshot(previous, { ...mesh, marks: [{ ...mesh.marks[0], marks: mesh.marks[0].marks.slice(0, 2) }] }, report)).toThrow(/Неполная/)
  })
  it('останавливается при отсутствующем или некорректном условном пороге и при плохом подтверждённом журнале', () => {
    expect(() => proposeGradeSnapshot({ ...previous, working_threshold: undefined }, mesh, report)).toThrow(/условный рабочий порог/)
    expect(() => proposeGradeSnapshot({ ...previous, working_threshold: 4 }, mesh, report)).toThrow(/условный рабочий порог/)
    expect(() => proposeGradeSnapshot({ ...previous, working_threshold_status: 'confirmed' }, mesh, report)).toThrow(/условный рабочий порог/)
    expect(() => proposeGradeSnapshot({ ...previous, subjects: [{ ...previous.subjects[0], grades: [[6, 1]] }] }, mesh, report)).toThrow(/Некорректный подтверждённый журнал/)
  })
  it('исправляет устаревший расчёт без новых оценок и повторно возвращает тот же объект', () => {
    const unchangedMesh = { ...mesh, marks: [{ ...mesh.marks[0], count: 2, average: 4.67,
      marks: [{ value: 5, weight: 2 }, { value: 4, weight: 1 }] }] }
    const weightedPrevious = { ...previous,
      subjects: [{ ...previous.subjects[0], grades: [[5, 2], [4, 1]], displayed_average: 4.67, app_more_fives: 8 }] }
    const repaired = proposeGradeSnapshot(weightedPrevious, unchangedMesh, report)
    expect(repaired.changes).toHaveLength(1)
    expect(repaired.changes[0]).toMatchObject({ added: [], previous_app_more_fives: 8, app_more_fives: 2 })
    expect(repaired.proposal.subjects[0].grades).toEqual([[5, 2], [4, 1]])
    const repeated = proposeGradeSnapshot(repaired.proposal, unchangedMesh, report)
    expect(repeated.changes).toEqual([])
    expect(repeated.proposal).toBe(repaired.proposal)
  })
})
