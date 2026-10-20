import { describe, expect, it } from 'vitest'
import { familyDashboardDateDelta } from './family-dashboard-delta.mjs'

const owner = { familyId: 'family-1', childId: 'child-1', role: 'student' }
const previous = {
  schemaVersion: 1, kind: 'student', familyId: owner.familyId, childId: owner.childId,
  canonicalToken: 'student-token', viewTokens: { student: 'student-token', parent: 'parent-token' },
  schoolCalendar: { revision: 'retained' }, unrelatedProjection: { keep: true },
  days: [
    { date: '2026-10-21', homework: [{ subject: 'Математика', text: 'Старое состояние' }], homeworkDayToken: 'day-21', extra: 'untouched' },
    { date: '2026-10-23', homework: [], homeworkDayToken: null, schedule: [{ subject: 'Русский язык' }], checkedAt: 'old-check' },
  ],
}
const expected = { date: '2026-10-23', homework: [{ subject: 'Русский язык', text: 'Подготовка к сочинению' }], homeworkDayToken: 'day-22' }

describe('family dashboard date-row delta', () => {
  it('changes only the requested date row and preserves stale unrelated rows and top-level fields', () => {
    const next = familyDashboardDateDelta(previous, expected, { ...owner, changedSubject: 'Русский язык', at: '2026-10-20T12:00:00.000Z' })
    expect(next).not.toBeNull()
    expect(next.days[0]).toEqual(previous.days[0])
    expect(next.days[1]).toEqual({ ...previous.days[1], ...expected,
      homeworkUpdate: { at: '2026-10-20T12:00:00.000Z', subjects: ['Русский язык'] } })
    expect(next.schoolCalendar).toBe(previous.schoolCalendar)
    expect(next.unrelatedProjection).toBe(previous.unrelatedProjection)
    expect(next).toMatchObject({ kind: 'student', familyId: owner.familyId, childId: owner.childId, viewTokens: previous.viewTokens })
  })

  it('returns no change on a repeat after the addressed row is current', () => {
    const first = familyDashboardDateDelta(previous, expected, { ...owner, changedSubject: 'Русский язык', at: '2026-10-20T12:00:00.000Z' })
    expect(familyDashboardDateDelta(first, expected, owner)).toBeNull()
  })

  it('rejects a different owner/role and ambiguous or missing date row', () => {
    expect(() => familyDashboardDateDelta(previous, expected, { ...owner, childId: 'other' })).toThrow(/владельцем и ролью/)
    expect(() => familyDashboardDateDelta(previous, expected, { ...owner, role: 'parent' })).toThrow(/владельцем и ролью/)
    expect(() => familyDashboardDateDelta({ ...previous, days: [previous.days[0]] }, expected, owner)).toThrow(/ровно одна строка/)
    expect(() => familyDashboardDateDelta({ ...previous, days: [...previous.days, previous.days[1]] }, expected, owner)).toThrow(/ровно одна строка/)
  })
})
