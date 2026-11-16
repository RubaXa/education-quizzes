/** @see ../docs/modules/assignments/README.md#readiness-and-handover */
import { expect, it, vi } from 'vitest'
import { readWorkEvidence } from './work-evidence.mjs'
const owner = { familyId: 'family', childId: 'child' }
const page = { ...owner, kind: 'student', date: '2026-11-15', targetDate: '2026-11-16', subjects: [{ tasks: [{ id: 'task', instructionStatus: { state: 'reviewed' }, problems: [{ id: 'p1' }, { id: 'p2' }] }] }] }
function fixture(foreign = false) {
  const rows = { 'dayPages/token': page, 'dayOwners/token': foreign ? { familyId: 'other', childId: 'other' } : owner,
    'dayProgress/token/items/p1': { status: 'verified' }, 'dayProgress/token/items/p2': { status: 'verified' } }
  return { doc: path => ({ path }), getAll: async (...refs) => refs.map(ref => ({ data: () => rows[ref.path] })), collection: vi.fn(() => ({ where: () => ({ get: async () => ({ docs: [{ id: 'photo', data: () => ({ taskId: 'task', status: 'reviewed' }) }] }) }) })) }
}
it('finds every required problem and preserved photo without changing work', async () => {
  const result = await readWorkEvidence(fixture(), { owner, token: 'token', taskIds: ['task'] })
  expect(result.gate).toMatchObject({ work: 'verified', verifiedIds: ['p1', 'p2'], missingIds: [] })
  expect(result.uploads).toHaveLength(1)
})
it('rejects another child before reading their reviews or photographs', async () => {
  const db = fixture(true)
  await expect(readWorkEvidence(db, { owner, token: 'token', taskIds: ['task'] })).rejects.toThrow('owner_mismatch')
  expect(db.collection).not.toHaveBeenCalled()
})
