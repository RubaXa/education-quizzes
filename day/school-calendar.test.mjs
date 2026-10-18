/** @see ../docs/modules/school-diary/school-calendar.md */
import { expect, it } from 'vitest'
import { applySchoolCalendar, normalizeMeshCalendar, publicSchoolCalendar, schoolCalendarGroups, vacationOn } from './school-calendar.mjs'
const owner = { familyId: 'family-a', childId: 'child-a', sourcePersonId: 'mesh-a' }
const capture = (payload) => ({ schemaVersion: 1, source: 'mesh', owner, query: { from: '2026-10-23', to: '2026-10-28' }, fetchedAt: '2026-10-19T00:00:00Z', payload })
const rows = [
  { date: '2026-10-23', type: 'workday', title: 'Учебный период' },
  { date: '2026-10-24', type: 'vacation', title: 'Каникулы' },
  { date: '2026-10-25', type: 'holiday', title: 'Каникулы' },
  { date: '2026-10-26', type: 'vacation', title: 'Каникулы' },
  { date: '2026-10-27', type: 'holiday', title: 'Учебный период' },
  { date: '2026-10-28', type: 'other', title: null },
]
const normalized = () => ({ ...normalizeMeshCalendar(capture(rows), owner), revision: 'a'.repeat(64) })
it('uses vacation type and explicit MESH vacation titles, including holiday days, never empty lessons or seasons', () => {
  const result = normalized()
  expect(result.vacations).toEqual([{ from: '2026-10-24', to: '2026-10-26', title: 'Каникулы' }])
  expect(vacationOn(result, '2026-10-27')).toBeUndefined()
  expect(vacationOn(result, '2026-10-28')).toBeUndefined()
  const winter = rows.map(row => ({ ...row, type: 'holiday', title: 'Зимние каникулы' }))
  expect(normalizeMeshCalendar(capture(winter), owner).vacations).toEqual([{ from: '2026-10-23', to: '2026-10-28', title: 'Зимние каникулы' }])
})
it('rejects wrong pupil, sparse/duplicate days and unknown or contradictory types', () => {
  expect(() => normalizeMeshCalendar(capture(rows), { ...owner, childId: 'other' })).toThrow('invalid_calendar_capture')
  expect(() => normalizeMeshCalendar(capture(rows), { ...owner, sourcePersonId: 'other' })).toThrow('invalid_calendar_capture')
  expect(() => normalizeMeshCalendar(capture(rows.slice(1)), owner)).toThrow('incomplete_school_calendar')
  expect(() => normalizeMeshCalendar(capture([rows[0], rows[0], ...rows.slice(2)]), owner)).toThrow('invalid_calendar_day')
  expect(() => normalizeMeshCalendar(capture([{ ...rows[0], type: 'unexpected' }, ...rows.slice(1)]), owner)).toThrow('invalid_calendar_day')
  expect(() => normalizeMeshCalendar(capture([{ ...rows[0], title: 'Каникулы' }, ...rows.slice(1)]), owner)).toThrow('conflicting_calendar_day')
})
it('excludes private source identities from the shared public projection', () => {
  const value = publicSchoolCalendar(normalized(), owner)
  expect(value).not.toHaveProperty('owner')
  expect(JSON.stringify(value)).not.toMatch(/family-a|child-a|mesh-a|payload/)
  expect(() => publicSchoolCalendar(normalized(), { ...owner, childId: 'other' })).toThrow('school_calendar_owner_mismatch')
})
it('extends a bounded horizon without manufacturing lessons, hiding homework, or mutating known days', () => {
  const prior = { today: '2026-10-19', days: [{ date: '2026-10-24', complete: true, schedule: [{ subject: 'Консультация' }], homework: [{ text: 'Задание' }], dayToken: 'saved', homeworkUpdate: { at: 'saved' } }], weekendWork: [{ title: 'Спецкурс' }] }
  const before = JSON.stringify(prior), result = applySchoolCalendar(prior, publicSchoolCalendar(normalized(), owner))
  expect(result.days.find(day => day.date === '2026-10-24')).toBe(prior.days[0])
  expect(result.days.find(day => day.date === '2026-10-25')).toMatchObject({ complete: false, checkedAt: null, schedule: [], homework: [] })
  expect(result.weekendWork).toBe(prior.weekendWork)
  expect(JSON.stringify(prior)).toBe(before)
  expect(applySchoolCalendar(prior, null)).toBe(prior)
})
it('groups only contiguous source intervals, retaining every selectable day and unknown gaps', () => {
  const calendar = publicSchoolCalendar(normalized(), owner)
  const days = rows.map(row => ({ date: row.date }))
  const groups = schoolCalendarGroups(days, calendar)
  expect(groups.map(group => group.days.length)).toEqual([1, 3, 1, 1])
  expect(groups[1].vacation.title).toBe('Каникулы')
  expect(schoolCalendarGroups([days[1], days[3]], calendar)).toHaveLength(2)
  expect(schoolCalendarGroups(days, { ...calendar, source: 'guessed' }).every(group => !group.vacation)).toBe(true)
})
