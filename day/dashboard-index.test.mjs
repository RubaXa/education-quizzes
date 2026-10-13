import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildDayDashboardIndex } from './dashboard-index.mjs'

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
