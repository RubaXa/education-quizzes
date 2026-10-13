import { describe, expect, it } from 'vitest'
import { daySourceRevision } from './day-source-revision.mjs'
import { pendingPublicationDates, refreshedCalendarChecks } from './publication-audit.mjs'

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
  it('advances a check time without replacing badges or unchanged work', () => {
    const prior = { ...day('revision', [{ subject: 'История', text: '§ 8' }]), checkedAt: '2026-10-12T09:00:00Z',
      homeworkUpdate: { at: '2026-10-12T09:00:00Z', subjects: ['История'] } }
    const fresh = { ...prior, checkedAt: '2026-10-13T14:00:00Z', homeworkUpdate: undefined }
    expect(refreshedCalendarChecks({ days: [fresh] }, { days: [prior] })?.[0]).toEqual({ ...prior, checkedAt: fresh.checkedAt })
  })
  it('does not advance the check time of changed or older source content', () => {
    const prior = { ...day('old', [{ subject: 'Литература', text: 'Читать' }]), checkedAt: '2026-10-12T09:00:00Z' }
    const newText = { ...prior, sourceRevision: 'new', checkedAt: '2026-10-13T14:00:00Z' }
    expect(refreshedCalendarChecks({ days: [newText] }, { days: [prior] })).toBeNull()
    expect(refreshedCalendarChecks({ days: [{ ...prior, checkedAt: '2026-10-11T09:00:00Z' }] }, { days: [prior] })).toBeNull()
  })
})
