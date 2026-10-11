import { describe, expect, it } from 'vitest'
import { assertGradeSnapshotAligned, detectGradeChange } from './grade-reconciliation.mjs'

describe('сверка оценок', () => {
  const grade = { subjects: [{ name: 'Математика', grades: [[5, 1], [4, 1]], displayed_average: 4.5 }] }
  const mesh = { complete: true, marks: [{ subject_name: 'Математика', count: 2, average: '4.50', marks: [
    { value: '4', weight: 1 }, { value: '5', weight: 1 },
  ] }] }

  it('не допускает устаревший срез после новой оценки', () => {
    expect(() => assertGradeSnapshotAligned(grade, { ...mesh, marks: [{ ...mesh.marks[0], count: 3, average: '4.67' }] })).toThrow(/отстаёт/)
  })
  it('сверяет полный список без зависимости от порядка', () => {
    expect(() => assertGradeSnapshotAligned(grade, mesh)).not.toThrow()
    expect(() => assertGradeSnapshotAligned({ subjects: [{ ...grade.subjects[0], grades: [[5, 1], [5, 1]] }] }, mesh)).toThrow(/расходится/)
  })
  it('обнаруживает исправление оценки при той же длине ленты', () => {
    expect(detectGradeChange({ grades: [[4, 1]], displayed_average: 4 }, { grades: [[5, 1]], displayed_average: 5 })).toMatchObject({ type: 'grade_changed' })
    expect(detectGradeChange({ grades: [[4, 1], [5, 1]], displayed_average: 4.5 }, { grades: [[5, 1], [4, 1]], displayed_average: 4.5 })).toBeNull()
  })
  it('сравнивает опубликованные объекты и возвращает добавленную отметку', () => {
    const previous = { grades: [{ mark: 4, weight: 1 }], displayed_average: 4 }
    const current = { grades: [{ mark: 4, weight: 1 }, { mark: 5, weight: 1 }], displayed_average: 4.5 }
    expect(detectGradeChange(previous, current)).toEqual({ type: 'grade_added', added: [[5, 1]] })
  })
})
