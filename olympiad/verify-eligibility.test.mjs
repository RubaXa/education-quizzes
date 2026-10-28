import { describe, expect, it } from 'vitest'
import { verifyOlympiadEligibility } from './verify-eligibility.mjs'
function setup() {
  const receipts = [1, 2, 3].map(n => ({ learnerToken: String(n).repeat(32), lessonId: `lesson-${n}`, testId: `test-${n}` }))
  const input = { familyId: 'family', childId: 'child', personId: 'person', grade: 6, receipts }
  const docs = new Map([['families/family', { active: true }], ['families/family/children/child', { active: true }], ['families/family/members/person', { active: true, role: 'student', childIds: ['child'] }]])
  for (const r of receipts) docs.set(`assignments/${r.learnerToken}`, { familyId: 'family', childId: 'child', testId: r.testId, slug: r.lessonId })
  const snap = p => ({ exists: docs.has(p), data: () => structuredClone(docs.get(p)) })
  const db = { doc(path) { return { path, get: async () => snap(path) } }, async runTransaction(fn) { const writes = []; await fn({ get: async r => snap(r.path), update(r, v) { writes.push([r.path, v]) } }); for (const [p, v] of writes) docs.set(p, { ...docs.get(p), ...v }) } }
  return { docs, db, input }
}
describe('confirmed olympiad grade', () => {
  it('writes and reads back grade, safely repeating', async () => {
    const { db, input } = setup()
    expect(await verifyOlympiadEligibility(db, input)).toEqual({ grade: 6, verified: true })
    expect(await verifyOlympiadEligibility(db, input)).toEqual({ grade: 6, verified: true })
  })
  it('does not overwrite an existing conflicting grade', async () => {
    const { docs, db, input } = setup()
    docs.get('families/family/children/child').olympiadEligibility = { grade: 7, verified: true }
    await expect(verifyOlympiadEligibility(db, input)).rejects.toThrow('Класс уже подтверждён')
    expect(docs.get('families/family/children/child').olympiadEligibility.grade).toBe(7)
  })
  it('rejects foreign assignment or inactive membership', async () => {
    for (const kind of ['assignment', 'membership']) {
      const { docs, db, input } = setup()
      if (kind === 'assignment') docs.get(`assignments/${input.receipts[0].learnerToken}`).childId = 'other'
      else docs.get('families/family/members/person').active = false
      await expect(verifyOlympiadEligibility(db, input)).rejects.toThrow()
      expect(docs.get('families/family/children/child').olympiadEligibility).toBeUndefined()
    }
  })
})
