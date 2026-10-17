import { createHash, randomBytes } from 'node:crypto'

/** @see ../../../docs/services/telegram-bot/adapters/firestore.md#подписка-и-обработка-сигнала @see ../../../docs/services/telegram-bot/ports-and-events.md#контракт-портов */
export function createFirestoreSourceCheckpointStore(db, { collection = 'telegramNotificationSourceCheckpoints', maxBytes = 512_000,
  maxDocumentBytes = 900_000 } = {}) {
  const rows = db.collection(collection)
  const refFor = (scopeKey, namespace) => rows.doc(`${namespace}_${createHash('sha256').update(scopeKey).digest('hex')}`)
  async function owned(tx, ref, { leaseToken, version, now }) {
    const snap = await tx.get(ref)
    if (!snap.exists) throw safeError('checkpoint_stale_lease')
    const row = snap.data()
    if (row.leaseToken !== leaseToken || row.version !== version || !now || row.leaseUntil <= now) throw safeError('checkpoint_stale_lease')
    return row
  }
  return {
    async acquire({ scopeKey, namespace, ownerBinding, workerId, now, leaseMs }) {
      const ref = refFor(scopeKey, namespace)
      const token = randomBytes(24).toString('base64url')
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        const old = snap.exists ? snap.data() : {}
        if (old.leaseUntil && old.leaseUntil > now) return { acquired: false, scopeKey }
        const binding = JSON.stringify(ownerBinding)
        const changedOwner = old.ownerBinding && old.ownerBinding !== binding
        const version = (old.version ?? 0) + (changedOwner ? 1 : 0)
        const state = { scopeKeyHash: ref.id.slice(namespace.length + 1), namespace, ownerBinding: binding,
          sequence: changedOwner ? 0 : old.sequence ?? 0, baseline: changedOwner ? null : old.baseline ?? null,
          pending: changedOwner ? null : old.pending ?? null, version, leaseOwner: workerId, leaseToken: token,
          leaseUntil: new Date(Date.parse(now) + leaseMs).toISOString(), updatedAt: now }
        if (serializedBytes(state) > maxDocumentBytes) throw safeError('checkpoint_too_large')
        tx.set(ref, state)
        return { ...state, acquired: true, scopeKey, leaseToken: token }
      })
    },
    async savePending({ scopeKey, namespace, leaseToken, version, pending, now }) {
      if (Buffer.byteLength(JSON.stringify(pending)) > maxBytes) throw safeError('checkpoint_too_large')
      const ref = refFor(scopeKey, namespace)
      return db.runTransaction(async (tx) => {
        const row = await owned(tx, ref, { leaseToken, version, now })
        if (serializedBytes({ ...row, pending }) > maxDocumentBytes) throw safeError('checkpoint_too_large')
        tx.update(ref, { pending })
      })
    },
    async advance({ scopeKey, namespace, leaseToken, version, sequence, baseline, now }) {
      const ref = refFor(scopeKey, namespace)
      return db.runTransaction(async (tx) => {
        const row = await owned(tx, ref, { leaseToken, version, now })
        const next = { ...row, sequence, baseline, pending: null, version: version + 1 }
        if (serializedBytes(next) > maxDocumentBytes) throw safeError('checkpoint_too_large')
        tx.update(ref, { sequence, baseline, pending: null, version: version + 1 })
      })
    },
    async renew({ scopeKey, namespace, leaseToken, version, now, leaseMs }) {
      const ref = refFor(scopeKey, namespace)
      return db.runTransaction(async (tx) => {
        await owned(tx, ref, { leaseToken, version, now })
        tx.update(ref, { leaseUntil: new Date(Date.parse(now) + leaseMs).toISOString(), updatedAt: now })
      })
    },
    async invalidateOwner({ scopeKey, namespace, leaseToken, version, now }) {
      const ref = refFor(scopeKey, namespace)
      return db.runTransaction(async (tx) => {
        await owned(tx, ref, { leaseToken, version, now })
        tx.update(ref, { sequence: 0, baseline: null, pending: null, version: version + 1, ownerInvalidatedAt: now })
      })
    },
    async release({ scopeKey, namespace, leaseToken }) {
      const ref = refFor(scopeKey, namespace)
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists || snap.data().leaseToken !== leaseToken) return false
        tx.update(ref, { leaseOwner: null, leaseToken: null, leaseUntil: null })
        return true
      })
    },
  }
}

function serializedBytes(value) { return Buffer.byteLength(JSON.stringify(value)) }
function safeError(code) { const error = new Error(code); error.safeCode = code; return error }
