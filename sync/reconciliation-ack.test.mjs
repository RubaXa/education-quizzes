/** @see ../docs/modules/synchronization/global-sync.md#operator-queue */
import { expect, it } from 'vitest'
import { acknowledgeReconciledDay } from './reconciliation-ack.mjs'
const scope = { runId: 'run', familyId: 'family', childId: 'child', date: '2026-11-09' }
function fixture() {
  let row = { kind: 'reconcile-day', runId: 'run', familyId: 'family', childId: 'child', sourceId: scope.date, fingerprint: 'revision-1', status: 'queued' }
  let writes = 0
  const snap = () => ({ data: () => structuredClone(row) })
  const ref = { get: async () => snap() }
  const db = { doc: () => ref, runTransaction: async work => work({ get: async () => snap(), update: (_, patch) => { writes++; row = { ...row, ...patch } } }) }
  const auditPublication = async () => ({ pending: [], expectedByDate: new Map([[scope.date, {}]]) })
  return { db, auditPublication, get: () => row, change: patch => { row = { ...row, ...patch } }, writes: () => writes }
}
it('closes exactly the checked revision from queued, with durable evidence and idempotent readback', async () => {
  const f = fixture()
  expect(await acknowledgeReconciledDay(f.db, { ...scope, auditPublication: f.auditPublication })).toMatchObject({ status: 'done', verified: true })
  expect(f.get()).toMatchObject({ acknowledgedFingerprint: 'revision-1', evidence: 'publication-audit:run:2026-11-09:both-roles' })
  await acknowledgeReconciledDay(f.db, { ...scope, auditPublication: f.auditPublication })
  expect(f.writes()).toBe(1)
})
it('rejects incomplete publication, missing date and a changed owner/run/revision without writes', async () => {
  for (const patch of [{ fingerprint: 'new' }, { runId: 'new' }, { childId: 'other' }]) {
    const f = fixture()
    await expect(acknowledgeReconciledDay(f.db, { ...scope, auditPublication: async () => { f.change(patch); return f.auditPublication() } })).rejects.toThrow('reconciliation_revision_changed')
    expect(f.writes()).toBe(0)
  }
  for (const audit of [{ pending: [{}], expectedByDate: new Map([[scope.date, {}]]) }, { pending: [], expectedByDate: new Map() }]) {
    const f = fixture()
    await expect(acknowledgeReconciledDay(f.db, { ...scope, auditPublication: async () => audit })).rejects.toThrow('reconciliation_publication_unverified')
    expect(f.writes()).toBe(0)
  }
})
it('does not clear a material blocker or a different task kind', async () => {
  const f = fixture(); f.change({ status: 'blocked' })
  await expect(acknowledgeReconciledDay(f.db, { ...scope, auditPublication: f.auditPublication })).rejects.toThrow('reconciliation_not_actionable')
  expect(f.writes()).toBe(0)
  f.change({ kind: 'review-work' })
  await expect(acknowledgeReconciledDay(f.db, { ...scope, auditPublication: f.auditPublication })).rejects.toThrow('reconciliation_owner_or_run_changed')
})

it('closes an internal permission wait after fresh both-role verification without another approval', async () => {
  const f = fixture(); f.change({ status: 'blocked', phase: 'awaiting-permission', reason: 'permission_required' })
  expect(await acknowledgeReconciledDay(f.db, { ...scope, auditPublication: f.auditPublication })).toMatchObject({ status: 'done', verified: true })
  expect(f.get()).toMatchObject({ reason: null, acknowledgedFingerprint: 'revision-1', resolvedBlock: { reason: 'permission_required', phase: 'awaiting-permission' } })
  await acknowledgeReconciledDay(f.db, { ...scope, auditPublication: f.auditPublication })
  expect(f.writes()).toBe(1)
})

it('keeps a real blocker that replaces the permission wait during the audit', async () => {
  const f = fixture(); f.change({ status: 'blocked', reason: 'permission_required' })
  await expect(acknowledgeReconciledDay(f.db, { ...scope, auditPublication: async () => {
    f.change({ reason: 'source_unavailable' }); return f.auditPublication()
  } })).rejects.toThrow('reconciliation_not_actionable')
  expect(f.writes()).toBe(0)
})
