import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'

/** Closed, durable operator queue. No credentials, answers or source text enter a job.
 * @see ../docs/modules/synchronization/global-sync.md#operator-queue
 */
export function syncJobId(kind, familyId, childId, sourceId) {
  return createHash('sha256').update(JSON.stringify([kind, familyId, childId, sourceId])).digest('hex')
}

export function syncFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function enqueueSyncJob(db, candidate) {
  const { kind, familyId, childId, sourceId, source, fingerprint, priority = 50, runId = null } = candidate
  if (!/^[a-z][a-z0-9-]{2,60}$/.test(kind) || !/^[A-Za-z0-9_-]{1,120}$/.test(familyId)
    || !/^[A-Za-z0-9_-]{1,120}$/.test(childId) || typeof sourceId !== 'string' || !sourceId
    || typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Недействительный ключ задания синхронизации.')
  const id = syncJobId(kind, familyId, childId, sourceId)
  const ref = db.doc(`operatorSyncJobs/${id}`)
  return db.runTransaction(async (tx) => {
    const previous = await tx.get(ref)
    const old = previous.data()
    if (old?.fingerprint === fingerprint) return { id, status: old.status, created: false }
    const now = Timestamp.now()
    tx.set(ref, { kind, familyId, childId, sourceId, source, fingerprint, priority, runId,
      status: 'queued', phase: 'discovered', reason: null, attempt: (old?.attempt ?? 0) + 1,
      createdAt: old?.createdAt ?? now, discoveredAt: now, updatedAt: now,
      completedAt: null, evidence: null })
    return { id, status: 'queued', created: true }
  })
}

export async function setSyncJob(db, id, status, phase, extra = {}) {
  if (!/^[a-f0-9]{64}$/.test(id) || !['processing', 'blocked', 'done'].includes(status)
    || !/^[a-z][a-z0-9-]{2,60}$/.test(phase)) throw new Error('Недействительное изменение очереди.')
  const ref = db.doc(`operatorSyncJobs/${id}`)
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) throw new Error('Задания нет в Firebase.')
    const before = snapshot.data()
    if (before.status === 'done' && status !== 'done') throw new Error('Завершённый вход нельзя взять повторно без новой ревизии источника.')
    if (before.status === 'done' && status === 'done') return before
    if (status === 'done' && !extra.evidence) throw new Error('Завершение требует подтверждённый источник результата.')
    const now = Timestamp.now()
    tx.update(ref, { status, phase, updatedAt: now,
      ...(status === 'done' ? { completedAt: now } : {}),
      ...(extra.evidence ? { evidence: extra.evidence } : {}),
      ...(extra.reason ? { reason: extra.reason } : {}),
      ...(extra.runId ? { runId: extra.runId } : {}) })
    return { ...before, status, phase }
  })
}
