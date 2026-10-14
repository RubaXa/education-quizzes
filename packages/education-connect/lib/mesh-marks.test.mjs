import { describe, expect, it } from 'vitest'
import { normalizeSubjectPeriods } from './mesh.mjs'

describe('полный журнал отметок МЭШ', () => {
  it('берёт только текущий период и все отметки, включая вид работы и комментарий', () => {
    const result = normalizeSubjectPeriods([{ subject_name: 'Математика', subject_id: 7, periods: [
      { title: 'I четверть', start_iso: '2026-09-01', end_iso: '2026-11-22', value: '4.50', count: 2,
        marks: [{ id: 1, value: '5', weight: 1, date: '2026-10-13', control_form_name: 'Практическая работа', comment: 'Хорошо' },
          { id: 2, value: '4', weight: 1, date: '2026-10-14', control_form_name: 'Домашнее задание', comment: '' }] },
      { title: 'II четверть', start_iso: '2026-11-23', end_iso: '2027-01-10', value: null, count: 0, marks: [] },
    ] }], '2026-10-14')
    expect(result).toEqual([{ subject_name: 'Математика', subject_id: 7, period: 'I четверть',
      start: '2026-09-01', end: '2026-11-22', average: '4.50', count: 2,
      marks: expect.arrayContaining([expect.objectContaining({ id: 1, control_form_name: 'Практическая работа', comment: 'Хорошо' })]) }])
  })
  it('отклоняет неполный список отметок вместо неверной привязки к одинаковым пятёркам', () => {
    expect(() => normalizeSubjectPeriods([{ subject_name: 'Русский язык', periods: [
      { title: 'I четверть', start_iso: '2026-09-01', end_iso: '2026-11-22', value: '5', count: 2, marks: [{ value: '5' }] },
    ] }], '2026-10-14')).toThrow(/неполный/)
  })
})
