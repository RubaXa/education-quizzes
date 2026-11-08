/** @see ../docs/decisions/sync-permission-scope-2026-11-08.md */
/** @see ../docs/modules/synchronization/global-sync.md#operator-queue */
/** @see ../docs/decisions/verified-reconciliation-ack-2026-11-06.md */
import { Timestamp } from '@google-cloud/firestore'
import { syncJobId } from './job-queue.mjs'

/** Acknowledge one exact revision only after a fresh publication audit. */
export async function acknowledgeReconciledDay(db, { runId, familyId, childId, date, auditPublication }) {
  const id = syncJobId('reconcile-day', familyId, childId, date)
  const ref = db.doc(`operatorSyncJobs/${id}`)
  const before = (await ref.get()).data()
  const matches = value => value?.kind === 'reconcile-day' && value.runId === runId
    && value.familyId === familyId && value.childId === childId && value.sourceId === date
  if (!matches(before)) throw new Error('reconciliation_owner_or_run_changed')
  const audit = await auditPublication()
  if (!audit || audit.pending?.length !== 0 || !(audit.expectedByDate instanceof Map)
    || !audit.expectedByDate.has(date)) throw new Error('reconciliation_publication_unverified')
  await db.runTransaction(async tx => {
    const live = (await tx.get(ref)).data()
    if (!matches(live) || live.fingerprint !== before.fingerprint) throw new Error('reconciliation_revision_changed')
    if (live.status === 'done') return
    if (!['queued', 'processing'].includes(live.status) && !(live.status === 'blocked' && live.reason === 'permission_required')) throw new Error('reconciliation_not_actionable')
    const now = Timestamp.now()
    tx.update(ref, { status: 'done', phase: 'readback-verified', reason: null, updatedAt: now, completedAt: now,
      ...(live.status === 'blocked' ? { resolvedBlock: { reason: live.reason, phase: live.phase ?? null, resolvedAt: now } } : {}),
      evidence: `publication-audit:${runId}:${date}:both-roles`, acknowledgedFingerprint: live.fingerprint })
  })
  const after = (await ref.get()).data()
  if (!matches(after) || after.fingerprint !== before.fingerprint || after.status !== 'done') throw new Error('reconciliation_readback_failed')
  return { id, date, status: 'done', verified: true }
}
