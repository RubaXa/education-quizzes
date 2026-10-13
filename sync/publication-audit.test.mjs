import { describe, expect, it } from 'vitest'
import { daySourceRevision } from './day-source-revision.mjs'
import { pendingPublicationDates } from './publication-audit.mjs'

const date = '2026-10-13'
const snapshot = (assignments = [], fetchedAt = '2026-10-12T10:00:00Z') => ({
  complete: true, fetchedAt, schedule: [{ id: 1, subject_name: 'Русский язык', start_at: '08:30' }], assignments,
})
const day = (revision, homework = []) => ({ date, sourceRevision: revision,
  schedule: [{ subject: 'Русский язык', start: '08:30', end: '' }], homework,
  dayToken: null, homeworkDayToken: homework.length ? 'page-token' : null })

describe('global publication reconciliation', () => {
  it('keeps the same revision when only fetch time changes', () => {
    expect(daySourceRevision(snapshot())).toBe(daySourceRevision(snapshot([], '2026-10-12T11:00:00Z')))
  })
  it('keeps a changed lesson pending on later downloads until publication catches up', () => {
    const before = daySourceRevision(snapshot())
    const assignment = [{ sourceItemId: '123', descriptions: ['Новый текст'], homeworkEntries: [{ id: '123', description: 'Новый текст' }] }]
    const after = daySourceRevision(snapshot(assignment))
    const expected = { days: [day(after, [{ subject: 'Русский язык', text: 'Новый текст' }])] }
    const published = { days: [day(before)] }
    expect(pendingPublicationDates(expected, published, [date])[0].reasons).toContain('source-revision-differs')
    expect(pendingPublicationDates(expected, { days: [expected.days[0]] }, [date])).toEqual([])
  })
  it('requires a page for homework even if the dashboard text was updated', () => {
    const entry = { ...day('revision', [{ subject: 'Русский язык', text: 'Упр. 3' }]), homeworkDayToken: null }
    expect(pendingPublicationDates({ days: [entry] }, { days: [entry] }, [date])[0].reasons).toContain('homework-page-missing')
  })
})
