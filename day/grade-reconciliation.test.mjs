import { describe, expect, it } from 'vitest'
import { assertGradeSnapshotAligned, chooseGradeJournal, detectGradeChange, gradeDetailRows, gradeProjectionPatch } from './grade-reconciliation.mjs'

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
  it('сохраняет разные работы и комментарии у одинаковых оценок только из полного сверенного журнала', () => {
    const saved = { subjects: [{ id: 'math', name: 'Математика', grades: [[5, 1], [5, 1]], displayed_average: 5 }] }
    const full = { complete: true, marks: [{ subject_name: 'Математика', average: 5, count: 2, marks: [
      { id: 11, value: '5', weight: 1, date: '2026-10-13', control_form_name: 'Домашнее задание', comment: 'Аккуратно' },
      { id: 12, value: '5', weight: 1, date: '2026-10-14', control_form_name: 'Практическая работа', comment: '' },
    ] }] }
    expect(gradeDetailRows(saved, full)[0].grades).toEqual([
      { mark: 5, weight: 1, sourceId: '11', date: '2026-10-13', workType: 'Домашнее задание', comment: 'Аккуратно' },
      { mark: 5, weight: 1, sourceId: '12', date: '2026-10-14', workType: 'Практическая работа' },
    ])
    expect(gradeDetailRows(saved, { ...full, marks: [{ ...full.marks[0], marks: full.marks[0].marks.slice(0, 1) }] })[0].grades)
      .toEqual([{ mark: 5, weight: 1 }, { mark: 5, weight: 1 }])
    expect(() => gradeDetailRows(saved, { ...full, marks: [{ ...full.marks[0], marks: [
      full.marks[0].marks[0], { ...full.marks[0].marks[1], value: '4' },
    ] }] })).toThrow(/расходится/)
  })
  it('выбирает прежний полный журнал при более новом кратком ответе МЭШ', () => {
    const latest = { ...mesh, fetchedAt: '2026-10-15T01:00:00Z', marks: [{ ...mesh.marks[0], marks: [{ value: '5', weight: 1 }] }] }
    const detailed = { ...mesh, fetchedAt: '2026-10-14T20:00:00Z', marks: [{ ...mesh.marks[0], marks: [
      { id: 11, value: '4', weight: 1, comment: 'Проверено' }, { id: 12, value: '5', weight: 1 },
    ] }] }
    expect(chooseGradeJournal(grade, [latest, detailed])).toBe(detailed)
  })
  it('восстанавливает одинаковые подробности на всех страницах дня и не переписывает неизменный срез', () => {
    const detailed = gradeDetailRows({ subjects: [{ id: 'math', ...grade.subjects[0] }] }, {
      ...mesh, marks: [{ ...mesh.marks[0], marks: [
        { id: 11, value: '4', weight: 1, comment: 'Проверено' }, { id: 12, value: '5', weight: 1 },
      ] }],
    })
    const desired = { gradeAsOf: '2026-10-14', gradeSummary: [{ id: 'math', average: 4.5 }], grades: detailed, workingThreshold: 4.55 }
    const stale = { ...desired, grades: [{ ...detailed[0], grades: [{ mark: 4, weight: 1 }, { mark: 5, weight: 1 }] }] }
    expect(gradeProjectionPatch(stale, desired)).toEqual({ grades: detailed })
    expect(gradeProjectionPatch(desired, desired)).toBeNull()
    expect(() => gradeProjectionPatch(desired, stale)).toThrow(/терять подробности/)
  })
})
