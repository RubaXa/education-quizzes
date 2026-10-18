/** @see ../../../docs/decisions/telegram-linked-work-history-2026-10-18.md */
import { createHash } from 'node:crypto'
import { FieldValue } from '@google-cloud/firestore'

/** @see ../../../docs/services/telegram-bot/work-history.md#подтверждённая-история */
export function createFirestoreWorkHistoryAdapter(db, { outboxCollection = 'telegramNotificationOutbox', streamCollection = 'telegramNotificationWorkStreams', historyCollection = 'telegramNotificationWorkHistory' } = {}) {
  const jobs = db.collection(outboxCollection)
  const streams = db.collection(streamCollection)
  const histories = db.collection(historyCollection)
  return {
    streamRef(job) { return streams.doc(workStreamKey(job)) },
    historyRefs(job, events) {
      return uniqueWorkRefs(events).map((workRef) => ({ workRef, ref: histories.doc(workHistoryKey(job, workRef)) }))
    },
    async acquireInTransaction(tx, job, { now, leaseToken, leaseUntil }) {
      const ref = streams.doc(workStreamKey(job))
      const snap = await tx.get(ref)
      const old = snap.exists ? snap.data() : null
      const tokenHash = hash(leaseToken)
      if (old?.jobId === job.jobId && old.leaseUntil > now && !old.heldForRetry) return { acquired: false }
      if (old?.jobId && old.jobId !== job.jobId) {
        const holderSnap = await tx.get(jobs.doc(old.jobId))
        const holder = holderSnap.exists ? holderSnap.data() : null
        if (holder && !['sent', 'blocked', 'dead_letter'].includes(holder.state)) return { acquired: false }
      }
      const fence = (old?.fence ?? 0) + 1
      tx.set(ref, { streamId: workStreamKey(job), jobId: job.jobId, workerId: job.leaseOwner,
        leaseTokenHash: tokenHash, fence, leaseUntil, heldForRetry: false, updatedAt: now })
      return { acquired: true, fence }
    },
    async historyBucketsInTransaction(tx, job, events) {
      const refs = this.historyRefs(job, events)
      const snaps = await Promise.all(refs.map(({ ref }) => tx.get(ref)))
      const messageByWork = new Map(refs.map(({ workRef }, i) => [workRef.id, snaps[i].exists ? snaps[i].data() : null]))
      const buckets = new Map()
      for (const event of events) {
        const workRef = validWorkRef(event?.workRef) ? event.workRef : null
        const pointer = workRef ? messageByWork.get(workRef.id) : null
        const target = pointer && Number.isSafeInteger(pointer.messageId) && pointer.messageId > 0 ? pointer.messageId : null
        const key = target === null ? 'new' : `reply:${target}`
        const list = buckets.get(key) ?? { replyToMessageId: target, events: [] }
        list.events.push(event)
        buckets.set(key, list)
      }
      return [...buckets.values()]
    },
    async savePartInTransaction(tx, job, part, receipt, { now, leaseToken, fence, leaseUntil }) {
      if (!Array.isArray(part?.workRefs) || !part.workRefs.length) return
      if (!validPartBindings(part)) throw safeError('work_history_invalid_part')
      const streamRef = streams.doc(workStreamKey(job))
      const streamSnap = await tx.get(streamRef)
      const gate = streamSnap.exists ? streamSnap.data() : null
      if (!gate || gate.jobId !== job.jobId || gate.workerId !== job.leaseOwner
        || gate.leaseTokenHash !== hash(leaseToken) || gate.fence !== fence || gate.leaseUntil <= now) throw safeError('work_history_gate_lost')
      const refs = part.workRefs.map((workRef) => ({ workRef, ref: histories.doc(workHistoryKey(job, workRef)) }))
      const snaps = await Promise.all(refs.map(({ ref }) => tx.get(ref)))
      for (let i = 0; i < refs.length; i += 1) {
        const previous = snaps[i].exists ? snaps[i].data() : null
        const partOrder = (part.workOrderBindings ?? []).filter((binding) => binding.workRef?.id === refs[i].workRef.id)
          .map((binding) => binding.order).sort().at(-1)
        if (!partOrder) throw safeError('work_history_missing_order')
        const latestOrder = partOrder
        const detectedAt = latestOrder.slice(0, -65)
        const eventId = latestOrder.slice(-64)
        if (previous?.latestOrder && previous.latestOrder > latestOrder) continue
        tx.set(refs[i].ref, {
          kind: 'day-task', workRefHash: refs[i].workRef.id,
          telegramUserId: String(job.telegramUserId), familyId: job.familyId, personId: job.personId,
          linkId: job.linkId, childId: job.childId, messageId: receipt.messageId, eventId,
          latestDetectedAt: detectedAt, latestOrder, sentAt: now, updatedAt: FieldValue.serverTimestamp(),
        })
      }
      tx.update(streamRef, { leaseUntil, updatedAt: now })
    },
    async releaseInTransaction(tx, jobRef, job, { leaseToken, now }) {
      if (!job?.jobId || !job?.telegramUserId) return
      const ref = streams.doc(workStreamKey(job))
      const snap = await tx.get(ref)
      if (!snap.exists) return
      const row = snap.data()
      if (row.jobId === job.jobId && row.leaseTokenHash === hash(leaseToken)) tx.update(ref, { leaseUntil: now, heldForRetry: false, releasedAt: now })
    },
    async releaseHeldInTransaction(tx, job, { now }) {
      if (!job?.jobId || !job?.telegramUserId) return
      const ref = streams.doc(workStreamKey(job))
      const snap = await tx.get(ref)
      if (!snap.exists) return
      const row = snap.data()
      if (row.jobId === job.jobId) tx.update(ref, { leaseUntil: now, heldForRetry: false, releasedAt: now })
    },
    async holdForRetryInTransaction(tx, job, { leaseToken, now }) {
      if (!job?.jobId || !job?.telegramUserId) return
      const ref = streams.doc(workStreamKey(job))
      const snap = await tx.get(ref)
      if (!snap.exists) return
      const row = snap.data()
      if (row.jobId === job.jobId && row.leaseTokenHash === hash(leaseToken)) tx.update(ref, { leaseUntil: null, heldForRetry: true, updatedAt: now })
    },
    async renewInTransaction(tx, job, { leaseToken, fence, now, leaseUntil }) {
      if (!fence) return
      const ref = streams.doc(workStreamKey(job))
      const snap = await tx.get(ref)
      const gate = snap.exists ? snap.data() : null
      if (!gate || gate.jobId !== job.jobId || gate.leaseTokenHash !== hash(leaseToken) || gate.fence !== fence || gate.leaseUntil <= now) throw safeError('work_history_gate_lost')
      tx.update(ref, { leaseUntil, updatedAt: now })
    },
  }
}

export function validWorkRef(ref) {
  return Boolean(ref && typeof ref === 'object' && !Array.isArray(ref) && ref.kind === 'day-task'
    && typeof ref.id === 'string' && /^[a-f0-9]{64}$/.test(ref.id)
    && Object.keys(ref).every((key) => ['kind', 'id'].includes(key)))
}
export function workStreamKey(job) {
  return hash(JSON.stringify(['telegram-recipient-stream-v1', String(job.telegramUserId), job.familyId, job.personId, job.linkId, job.childId]))
}
export function workHistoryKey(job, workRef) {
  return hash(JSON.stringify(['telegram-work-history-v1', String(job.telegramUserId), job.familyId, job.personId, job.linkId, job.childId, workRef.kind, workRef.id]))
}
function uniqueWorkRefs(events) {
  return [...new Map(events.map((event) => event?.workRef).filter(validWorkRef).map((workRef) => [workRef.id, workRef])).values()]
}
function validPartBindings(part) {
  if (!Array.isArray(part.workOrderBindings)) return false
  const allowed = new Set(part.workRefs.map((ref) => ref.id))
  return part.workOrderBindings.every((binding) => validWorkRef(binding?.workRef) && allowed.has(binding.workRef.id)
    && typeof binding.order === 'string' && /^[0-9T:.-]+Z:[a-f0-9]{64}$/.test(binding.order)
    && Number.isFinite(Date.parse(binding.order.slice(0, -65))))
    && part.workRefs.every((ref) => part.workOrderBindings.some((binding) => binding.workRef.id === ref.id))
}
function hash(value) { return createHash('sha256').update(value).digest('hex') }
function safeError(code) { const error = new Error(code); error.safeCode = code; return error }
