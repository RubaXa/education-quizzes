import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildDayDashboardIndex } from './dashboard-index.mjs'

/** @see ../docs/modules/school-diary/school-calendar.md#сбор */
it('retains an owned calendar across day republishing and rejects another child’s local source', () => {
  const local = mkdtempSync(resolve(tmpdir(), 'education-calendar-'))
  const owner = { familyId: 'family', childId: 'child' }
  const calendar = { schemaVersion: 1, source: 'mesh', from: '2026-09-01', to: '2027-08-31', checkedAt: '2026-10-19T00:00:00Z',
    revision: 'a'.repeat(64), vacations: [{ from: '2026-10-24', to: '2026-11-01', title: 'Каникулы' }] }
  try {
    mkdirSync(resolve(local, 'diary'))
    writeFileSync(resolve(local, 'context.json'), JSON.stringify(owner))
    writeFileSync(resolve(local, 'diary', 'school-calendar.json'), JSON.stringify({ ...calendar, owner }))
    for (const role of ['parent', 'student']) {
      const index = buildDayDashboardIndex(local, {}, role, new Date('2026-10-19T10:00:00Z'))
      expect(index.schoolCalendar).toEqual(calendar)
      expect(index.days.at(-1).date).toBe('2026-11-29')
    }
    rmSync(resolve(local, 'diary', 'school-calendar.json'))
    expect(buildDayDashboardIndex(local, {}, 'parent', new Date('2026-10-19T10:00:00Z'), calendar).schoolCalendar).toEqual(calendar)
    writeFileSync(resolve(local, 'diary', 'school-calendar.json'), JSON.stringify({ ...calendar, owner: { ...owner, childId: 'other' } }))
    expect(() => buildDayDashboardIndex(local, {}, 'parent')).toThrow('school_calendar_owner_mismatch')
  } finally { rmSync(local, { recursive: true, force: true }) }
})

describe('dashboard homework references', () => {
  it('links an exact Friday pointer to the published Thursday assignment', () => {
    const local = mkdtempSync(resolve(tmpdir(), 'education-week-'))
    try {
      mkdirSync(resolve(local, 'diary'))
      const base = (date, id, description) => ({ complete: true, date, fetchedAt: '2026-10-12T12:00:00Z',
        schedule: [], assignments: [{ sourceItemId: id, subjectName: 'Спецкурс по математике',
          homeworkEntries: [{ id, description }], detailStatus: 'loaded' }] })
      for (const [date, id, description] of [
        ['2026-10-15', '1', 'Решать задачи из файла.'],
        ['2026-10-16', '2', 'Смотри задание на четверг.'],
      ]) writeFileSync(resolve(local, 'diary', `snapshot-${date}.json`), JSON.stringify(base(date, id, description)))
      writeFileSync(resolve(local, 'day-source-2026-10-14.json'), JSON.stringify({ targetDate: '2026-10-15' }))
      const index = buildDayDashboardIndex(local, { '2026-10-14': { student: 'thursday-page' } }, 'student', new Date('2026-10-12T12:00:00Z'))
      expect(index.days.find((day) => day.date === '2026-10-16').homeworkDayToken).toBe('thursday-page')
    } finally { rmSync(local, { recursive: true, force: true }) }
  })
})
