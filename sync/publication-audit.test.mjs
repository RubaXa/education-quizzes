import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { daySourceRevision } from './day-source-revision.mjs'
import { pendingPublicationDates, publicationReconciliationCandidates, refreshedCalendarChecks, validatedFamilyDashboardAssignments } from './publication-audit.mjs'
import { dateWindow } from './project-plan.mjs'
import { buildDayDashboardIndex } from '../day/dashboard-index.mjs'

const date = '2026-10-13'
const snapshot = (assignments = [], fetchedAt = '2026-10-12T10:00:00Z') => ({
  complete: true, fetchedAt, schedule: [{ id: 1, subject_name: 'Русский язык', start_at: '08:30' }], assignments,
})
const day = (revision, homework = []) => ({ date, sourceRevision: revision,
  schedule: [{ subject: 'Русский язык', start: '08:30', end: '' }], homework,
  dayToken: null, homeworkDayToken: homework.length ? 'page-token' : null })

const familyEssay = (overrides = {}) => ({
  id: 'family-russian-essay-2026-10-23', familyId: 'family-1', childId: 'child-1', subjectId: 'russian',
  sourceSystem: 'family', sourceId: 'family-russian-essay-2026-10-23', sourceRevision: 1,
  dayProjectionVersion: 1, dueDate: '2026-10-23', title: 'Подготовка к сочинению',
  originalText: 'Выбери тему, запиши наблюдения, составь план и напиши первую версию.',
  studentText: 'Выбери тему, понаблюдай, составь план и напиши первую версию.', steps: ['Наблюдай', 'Планируй', 'Пиши'],
  cardPattern: 'composition', cardPolicyVersion: 1, outputKind: 'text-structure', publication: 'active', evidence: 'photo',
  submission: { buttonLabel: 'Прикрепить сочинение', lead: 'Прикрепи первую версию.', photo: 'Сфотографируй все страницы.' },
  materialIds: [], ...overrides,
})

describe('global publication reconciliation', () => {
  it('builds a zero-work reconciliation list after a collected 42-date no-diff audit', () => {
    const dates = dateWindow('2026-10-20')
    const expectedByDate = new Map(dates.map((date) => [date, { date, sourceRevision: `revision-${date}` }]))
    const publication = { pending: [], expectedByDate }
    expect(dates).toHaveLength(42)
    expect(publicationReconciliationCandidates(publication, [])).toEqual([])
    expect(() => publicationReconciliationCandidates({ pending: [] }, [])).toThrow('publication_audit_incomplete')
  })

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

  it('audits the same explicitly projected family homework as the published dashboard, while retaining MESH diffs', () => {
    const local = mkdtempSync(resolve(tmpdir(), 'education-publication-audit-family-'))
    try {
      mkdirSync(resolve(local, 'diary'))
      const snapshotFile = resolve(local, 'diary/snapshot-2026-10-23.json')
      const snapshot = { complete: true, date: '2026-10-23', fetchedAt: '2026-10-20T08:00:00Z',
        schedule: [{ subject_name: 'Русский язык', start_at: '09:00', finish_at: '09:45' }], assignments: [] }
      writeFileSync(snapshotFile, JSON.stringify(snapshot))
      writeFileSync(resolve(local, 'day-source-2026-10-22.json'), JSON.stringify({ targetDate: '2026-10-23', subjects: [] }))
      const links = { '2026-10-22': { student: 'student-22', parent: 'parent-22' } }
      const assignment = familyEssay()
      const allowed = validatedFamilyDashboardAssignments([assignment], {
        familyId: 'family-1', childId: 'child-1', dates: ['2026-10-22', '2026-10-23'],
      })
      const expected = buildDayDashboardIndex(local, links, 'student', new Date('2026-10-20T12:00:00Z'), null, allowed)
      const published = structuredClone(expected)
      expect(expected.days.find((item) => item.date === '2026-10-23').homework)
        .toContainEqual({ subject: 'Русский язык', text: assignment.title })
      expect(pendingPublicationDates(expected, published, ['2026-10-23'])).toEqual([])

      const meshChanged = { ...snapshot, assignments: [{ subjectName: 'Русский язык', homeworkEntries: [
        { id: 'mesh-russian-1', description: 'Упражнение 4' },
      ] }] }
      writeFileSync(snapshotFile, JSON.stringify(meshChanged))
      const changedExpected = buildDayDashboardIndex(local, links, 'student', new Date('2026-10-20T12:00:00Z'), null, allowed)
      expect(pendingPublicationDates(changedExpected, published, ['2026-10-23'])[0].reasons)
        .toContain('source-revision-differs')
      expect(pendingPublicationDates(changedExpected, published, ['2026-10-23'])[0].reasons)
        .toContain('homework-differs')
    } finally { rmSync(local, { recursive: true, force: true }) }
  })

  it('limits family audit overlays to valid, owned, explicitly projected tasks in the captured dates', () => {
    const canonical = familyEssay()
    const otherOwner = familyEssay({ childId: 'someone-else' })
    const otherDate = familyEssay({ id: 'family-russian-essay-2026-11-01', sourceId: 'family-russian-essay-2026-11-01', dueDate: '2026-11-01' })
    const unprojected = familyEssay({ id: 'family-russian-essay-unprojected', sourceId: 'family-russian-essay-unprojected', dayProjectionVersion: undefined })
    expect(validatedFamilyDashboardAssignments([canonical, otherDate, unprojected], {
      familyId: 'family-1', childId: 'child-1', dates: ['2026-10-22', '2026-10-23'],
    })).toEqual([canonical])
    expect(() => validatedFamilyDashboardAssignments([otherOwner], {
      familyId: 'family-1', childId: 'child-1', dates: ['2026-10-23'],
    })).toThrow(/Family dashboard assignment invalid/)
  })
})
