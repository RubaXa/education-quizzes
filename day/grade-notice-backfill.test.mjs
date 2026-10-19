import { describe, it, expect } from 'vitest'
import { assertGradeNoticeOwner, createGradeNotices, gradeNoticeBackfill } from './grade-notice-backfill.mjs'
import { meshChildIdentityId } from '../packages/education-runtime/identity.mjs'

const mark = (id, value, date = '2026-10-01') => ({ id, value, weight: 1, date })
const snapshot = (fetchedAt, marks) => ({ complete: true, fetchedAt, marks: [{
  subject_id: 1, subject_name: 'География', period: 'Первый', start: '2026-09-01', end: '2026-11-22',
  count: marks.length, average: (marks.reduce((sum, row) => sum + Number(row.value), 0) / marks.length).toFixed(2), marks,
}] })
const ledger = { observed_at: '2026-10-19', subjects: [{ id: 'geography', name: 'География',
  displayed_average: 4.67, grades: [[5, 1], [4, 1], [5, 1]] }] }
const before = snapshot('2026-10-18T10:00:00Z', [mark(1, '5'), mark(2, '4')])
const after = snapshot('2026-10-19T10:00:00Z', [mark(1, '5'), mark(2, '4'), mark(3, '5', '2026-10-05')])
describe('grade notice recovery', () => {
  it('preserves a notice read concurrently with recovery, then retries without rewriting it', async () => {
    const store = new Map()
    let first = true
    const db = { batch: () => {
      const pending = []
      return { create: (ref, value) => pending.push([ref, value]), commit: async () => {
        if (pending.some(([ref]) => store.has(ref))) throw Object.assign(Error('already exists'), { code: 6 })
        for (const [ref, value] of pending) store.set(ref, value)
      } }
    } }
    const stage = async (_db, batch) => {
      if (!store.has('notice')) batch.set('notice', { type: 'grade_added' })
      if (first) { first = false; store.set('notice', { type: 'grade_added', readAt: 'saved-by-reader' }) }
    }
    expect(await createGradeNotices(db, {}, [{}], stage)).toBe(0)
    expect(store.get('notice').readAt).toBe('saved-by-reader')
  })
  it('recovers a backdated addition after projections have already been updated', () => {
    const [notice] = gradeNoticeBackfill(before, after, ledger, 'child')
    expect(notice.data).toMatchObject({ type: 'grade_added', subject: 'География' })
    expect(notice.key).toMatch(/^grade:child:geography:[a-f0-9]{64}$/)
    expect(gradeNoticeBackfill(before, after, ledger, 'child')).toEqual([notice])
  })
  it('ignores order-only changes', () => {
    const same = { ...after, fetchedAt: '2026-10-20T10:00:00Z', marks: after.marks.map((row) => ({ ...row, marks: [...row.marks].reverse() })) }
    expect(gradeNoticeBackfill(after, same, ledger, 'child')).toEqual([])
  })
  it('rejects corrections, removals and incomplete baselines instead of announcing them as new', () => {
    expect(() => gradeNoticeBackfill({ ...before, complete: false }, after, ledger, 'child')).toThrow()
    const changed = snapshot('2026-10-19T10:00:00Z', [mark(1, '4'), mark(2, '4'), mark(3, '5')])
    const correctedLedger = { ...ledger, subjects: [{ ...ledger.subjects[0], displayed_average: 4.33, grades: [[4, 1], [4, 1], [5, 1]] }] }
    expect(() => gradeNoticeBackfill(before, changed, correctedLedger, 'child')).toThrow(/изменена/)
    const removed = snapshot('2026-10-19T10:00:00Z', [mark(1, '5'), mark(3, '5')])
    const shorterLedger = { ...ledger, subjects: [{ ...ledger.subjects[0], displayed_average: 5, grades: [[5, 1], [5, 1]] }] }
    expect(() => gradeNoticeBackfill(before, removed, shorterLedger, 'child')).toThrow(/снята/)
  })
  it('rejects invalid dates before preparing any notice', () => {
    expect(() => gradeNoticeBackfill({ ...before, fetchedAt: 'invalid' }, after, ledger, 'child')).toThrow()
    expect(() => gradeNoticeBackfill(before, { ...after, fetchedAt: 'invalid' }, ledger, 'child')).toThrow()
    expect(() => gradeNoticeBackfill(before, after, { ...ledger, observed_at: 'invalid' }, 'child')).toThrow()
  })
  it('requires both exact snapshot child identities and an active registered family child', () => {
    const context = { familyId: 'family', childId: 'child', family: { active: true }, child: { active: true, meshPersonId: 'mesh-child' },
      identity: { id: meshChildIdentityId('mesh-child'), source: 'mesh', familyId: 'family', childId: 'child', sourcePersonId: 'mesh-child' } }
    const owned = { profile: { children: [{ contingent_guid: 'mesh-child' }] } }
    expect(() => assertGradeNoticeOwner(owned, owned, context)).not.toThrow()
    expect(() => assertGradeNoticeOwner(owned, { profile: { children: [{ contingent_guid: 'other' }] } }, context)).toThrow()
    expect(() => assertGradeNoticeOwner(owned, { profile: { children: [owned.profile.children[0], owned.profile.children[0]] } }, context)).toThrow()
    expect(() => assertGradeNoticeOwner(owned, owned, { ...context, child: { ...context.child, active: false } })).toThrow()
  })
})
