import { randomBytes } from 'node:crypto'
import { FieldValue, Timestamp } from '@google-cloud/firestore'
import { createEducationEventId } from '../education-events/envelope.mjs'

/** @see ../../docs/modules/synchronization/event-queue.md @see ../../docs/services/telegram-bot/adapters/firestore.md */
export const EDUCATION_EVENT_COLLECTION = 'educationEvents'
export const EDUCATION_EVENT_TYPES = Object.freeze([
  'help.requested', 'upload.confirmed', 'upload.transfer_requested', 'upload.bytes_uploaded', 'upload.delete_requested', 'quiz.submitted', 'quiz.followup_requested',
  'quiz.requirement_changed', 'parent.guidance_sent', 'parent.decision', 'material.upload_requested', 'material.bytes_uploaded', 'material.ready',
  'review.published', 'schedule.created', 'schedule.changed', 'schedule.cancelled', 'homework.assigned', 'homework.changed',
  'homework.cancelled', 'grade.created', 'grade.changed', 'quiz.started', 'review.changed', 'material.requirement_changed', 'technical.probe',
])
const ALLOWED_TYPES = new Set(EDUCATION_EVENT_TYPES)

const ID = /^[A-Za-z0-9_-]{1,128}$/
const SOURCE_KINDS = new Set(['upload', 'review', 'quiz', 'material', 'help', 'guidance', 'parent-decision', 'mesh'])

export async function educationEventId({ source, sourceRef, eventType, operationId, familyId, childId }) {
  for (const value of [source, eventType, operationId, familyId, childId]) if (typeof value !== 'string' || !value.trim()) throw new Error('invalid_event_identity')
  if (!sourceRef || typeof sourceRef !== 'object' || Array.isArray(sourceRef)) throw new Error('invalid_event_identity')
  return createEducationEventId({ source, sourceRef: canonicalSourceRef(sourceRef), eventType, operationId, familyId, childId })
}

export async function normalizeEducationEvent(input, { now = new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object') throw new Error('invalid_event')
  const { source, sourceRef, eventType, familyId, childId, actor, operationId } = input
  if (!['mesh', 'firestore'].includes(source)
    || !validSourceRef(sourceRef) || !validRef(familyId) || !validRef(childId)
    || !ALLOWED_TYPES.has(eventType)
    || !validOperationId(operationId) || !validActor(actor)) throw new Error('invalid_event_envelope')
  const eventId = await educationEventId({ source, sourceRef, eventType, operationId, familyId, childId })
  if (input.eventId !== undefined && input.eventId !== eventId) throw new Error('event_id_mismatch')
  const createdAt = validTime(input.createdAt) ?? validTime(now)
  if (!createdAt) throw new Error('invalid_event_time')
  const payload = source === 'mesh' ? safeMeshPayload(input.payload) : {}
  return Object.freeze({ schemaVersion: 1, eventId, source: ['mesh'].includes(source) ? 'mesh' : 'firestore', sourceRef: canonicalSourceRef(sourceRef),
    familyId, childId, actor, eventType, operationId, createdAt, state: 'pending', availableAt: createdAt, attempts: 0, fanout: {}, payload })
}

/** One idempotent write path for trusted backend producers (including Mesh). */
export async function prepareEducationEvent(input, options = {}) {
  const event = await normalizeEducationEvent(input, options)
  const timestamp = options.timestamp ?? FieldValue.serverTimestamp()
  return { ...event, createdAt: timestamp, availableAt: timestamp }
}

/** Stage the event in the caller's source write transaction/batch. The caller owns atomic source mutation. */
export async function stageEducationEvent(tx, db, input, options = {}) {
  const event = await prepareEducationEvent(input, options)
  const ref = db.collection(options.collection ?? EDUCATION_EVENT_COLLECTION).doc(event.eventId)
  const existing = await tx.get(ref)
  if (existing.exists) {
    assertSameEventIdentity(existing.data(), event)
    return { eventId: event.eventId, ref, event, created: false }
  }
  tx.create(ref, event)
  return { eventId: event.eventId, ref, event, created: true }
}

export async function publishEducationEvent(db, input, options = {}) {
  const event = await prepareEducationEvent(input, options)
  const persisted = event
  const ref = db.collection(options.collection ?? EDUCATION_EVENT_COLLECTION).doc(event.eventId)
  const created = await db.runTransaction(async (tx) => {
    const prior = await tx.get(ref)
    if (prior.exists) {
      assertSameEventIdentity(prior.data(), event)
      return false
    }
    tx.create(ref, persisted)
    return true
  })
  return { eventId: event.eventId, created }
}

export function createFirestoreEducationEventStore(db, { collection = EDUCATION_EVENT_COLLECTION, batchSize = 100, recoveryPollMs = 30_000 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('invalid_event_batch_size')
  const events = db.collection(collection)
  const cursors = new Map()
  const candidateBuffers = new Map()
  const bufferLoads = new Map()
  const recoveryPolledAt = new Map()
  return {
    subscribePending(onWake, onError = () => {}) {
      // Exactly one durable queue subscription. All app and Mesh actions share this ingress.
      return events.where('state', '==', 'pending').orderBy('availableAt').limit(batchSize).onSnapshot(
        () => onWake(), onError)
    },
    async listReady({ now, workerId }) {
      const nowTimestamp = Timestamp.fromDate(new Date(now))
      if (!(candidateBuffers.get(workerId) ?? []).length) {
        let loading = bufferLoads.get(workerId)
        if (!loading) {
          loading = (async () => {
        const lastRecovery = recoveryPolledAt.get(workerId) ?? 0
        if (Date.parse(now) - lastRecovery >= recoveryPollMs) {
          const expired = await events.where('state', '==', 'processing').where('leaseUntil', '<=', nowTimestamp).orderBy('leaseUntil').limit(batchSize).get()
          const buffer = expired.docs.map((doc) => ({ ...doc.data(), eventId: doc.id, ref: doc.ref }))
          recoveryPolledAt.set(workerId, Date.parse(now))
          candidateBuffers.set(workerId, buffer)
        }
        if (!(candidateBuffers.get(workerId) ?? []).length) {
          let query = events.where('state', '==', 'pending').where('availableAt', '<=', nowTimestamp).orderBy('availableAt').limit(batchSize)
          const cursor = cursors.get(workerId)
          if (cursor) query = query.startAfter(cursor)
          let snapshot = await query.get()
          if (!snapshot.docs.length && cursor) {
            cursors.delete(workerId)
            snapshot = await events.where('state', '==', 'pending').where('availableAt', '<=', nowTimestamp).orderBy('availableAt').limit(batchSize).get()
          }
          if (snapshot.docs.length) cursors.set(workerId, snapshot.docs.at(-1))
          candidateBuffers.set(workerId, snapshot.docs.map((doc) => ({ ...doc.data(), eventId: doc.id, ref: doc.ref })))
        }
          })()
          bufferLoads.set(workerId, loading)
        }
        try { await loading } finally { if (bufferLoads.get(workerId) === loading) bufferLoads.delete(workerId) }
      }
      const buffer = candidateBuffers.get(workerId) ?? []
      while (buffer.length) {
        const candidate = buffer.shift()
        if ((candidate.state === 'pending' && millis(candidate.availableAt) <= Date.parse(now))
          || (candidate.state === 'processing' && millis(candidate.leaseUntil) <= Date.parse(now))) {
          candidateBuffers.set(workerId, buffer)
          return [candidate]
        }
      }
      candidateBuffers.set(workerId, buffer)
      return []
    },
    async claim({ eventId, workerId, now, leaseMs }) {
      const ref = events.doc(eventId)
      const token = randomBytes(32).toString('base64url')
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists) return null
        const row = snap.data() ?? {}
        const due = millis(row.availableAt)
        const expired = row.state === 'processing' && millis(row.leaseUntil) <= Date.parse(now)
        if ((row.state !== 'pending' && !expired) || (!Number.isFinite(due) && !expired) || (!expired && due > Date.parse(now))) return null
        const fence = (row.fence ?? 0) + 1
        const leaseUntil = Timestamp.fromDate(new Date(Date.parse(now) + leaseMs))
        const claimed = { state: 'processing', leaseOwner: workerId, leaseToken: token, leaseUntil, fence,
          attempts: (row.attempts ?? 0) + 1, claimedAt: now }
        tx.update(ref, claimed)
        return { ...row, ...claimed, eventId, claimedEnvelopeEventId: row.eventId }
      })
    },
    async checkpoint({ eventId, workerId, leaseToken, fence, phase, receipt = null, now }) {
      return mutateOwned(db, events.doc(eventId), { workerId, leaseToken, fence }, now, (tx, ref, row) => {
        const safeReceipt = normalizePhaseReceipt(receipt)
        tx.update(ref, { fanout: { ...(row.fanout ?? {}), [phase]: { state: 'complete', completedAt: now,
          ...(safeReceipt ? { receipt: safeReceipt } : {}) } }, updatedAt: now })
        return true
      })
    },
    async finish({ eventId, workerId, leaseToken, fence, state = 'complete', now, safeErrorCode = null }) {
      if (!['complete', 'blocked', 'dead_letter'].includes(state)) throw new Error('invalid_terminal_event_state')
      return mutateOwned(db, events.doc(eventId), { workerId, leaseToken, fence }, now, (tx, ref) => {
        tx.update(ref, { state, finishedAt: now, ...(safeErrorCode ? { safeErrorCode } : {}), leaseOwner: null,
          leaseToken: null, leaseUntil: null })
        return true
      })
    },
    async retry({ eventId, workerId, leaseToken, fence, now, nextAttemptAt, safeErrorCode }) {
      return mutateOwned(db, events.doc(eventId), { workerId, leaseToken, fence }, now, (tx, ref, row) => {
        tx.update(ref, { state: 'pending', availableAt: Timestamp.fromDate(new Date(nextAttemptAt)), safeErrorCode, leaseOwner: null, leaseToken: null,
          leaseUntil: null, lastFailureAt: now, attempts: row.attempts })
        return true
      })
    },
    async renew({ eventId, workerId, leaseToken, fence, now, leaseMs }) {
      return mutateOwned(db, events.doc(eventId), { workerId, leaseToken, fence }, now, (tx, ref) => {
        const leaseUntil = Timestamp.fromDate(new Date(Date.parse(now) + leaseMs))
        tx.update(ref, { leaseUntil })
        return leaseUntil
      })
    },
  }
}

/** Fanout phases are checkpointed after each durable effect; handlers must be idempotent by eventId. */
export class EducationEventConsumer {
  constructor({ store, handlers, workerId, clock = () => new Date(), leaseMs = 60_000, maxAttempts = 12,
    retryBaseMs = 1_000, concurrency = 1, handlerTimeoutMs = 600_000, onError = () => {}, onReady = () => {} }) {
    if (!store || typeof store.listReady !== 'function' || typeof store.claim !== 'function' || !workerId
      || !handlers || typeof handlers !== 'object' || !Number.isInteger(concurrency) || concurrency < 1) throw new Error('invalid_event_consumer_config')
    this.store = store; this.handlers = handlers; this.workerId = workerId; this.clock = clock; this.leaseMs = leaseMs
    this.maxAttempts = maxAttempts; this.retryBaseMs = retryBaseMs; this.concurrency = concurrency; this.handlerTimeoutMs = handlerTimeoutMs
    this.onError = onError; this.onReady = onReady
    this.closed = false; this.unsubscribe = null; this.inflight = new Set(); this.runTasks = new Set(); this.controllers = new Set(); this.wake = () => {}
  }

  runOne() {
    const task = (async () => {
      if (this.closed) return false
      const now = this.clock().toISOString()
      const candidates = await this.store.listReady({ now, workerId: this.workerId })
      for (const candidate of candidates) {
        if (this.closed) return false
        const claim = await this.store.claim({ eventId: candidate.eventId, workerId: this.workerId,
          now: this.clock().toISOString(), leaseMs: this.leaseMs })
        if (!claim) continue
        const processing = this.#process(claim)
        this.inflight.add(processing)
        try { await processing } finally { this.inflight.delete(processing) }
        return true
      }
      return false
    })()
    this.runTasks.add(task)
    void task.then(() => this.runTasks.delete(task), () => this.runTasks.delete(task))
    return task
  }

  async start({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    if (this.closed) return
    if (this.unsubscribe) return
    let stopped = false
    const timers = new Map(), running = new Set(), idleMs = new Map()
    const schedule = (lane, delay = 0, force = false) => {
      if (stopped) return
      if (running.has(lane)) return
      const prior = timers.get(lane)
      if (prior && force) { clearTimer(prior); timers.delete(lane) }
      if (timers.has(lane)) return
      timers.set(lane, setTimer(async () => {
        timers.delete(lane)
        if (stopped || running.has(lane)) return
        running.add(lane)
        let nextDelay = 1_000
        try {
          const hadWork = await this.runOne()
          if (hadWork) { idleMs.set(lane, 1_000); nextDelay = 0 }
          else {
            const wait = idleMs.get(lane) ?? 1_000
            nextDelay = wait
            idleMs.set(lane, Math.min(60_000, wait * 2))
          }
        } catch (error) {
          this.onError({ code: 'event_consumer_failed', safeCode: safeCode(error) })
        } finally {
          running.delete(lane)
          if (!stopped) schedule(lane, nextDelay)
        }
      }, delay))
    }
    this.wake = () => { for (let lane = 0; lane < this.concurrency; lane += 1) schedule(lane, 0, true) }
    let acknowledgeReady
    let rejectReady
    let ready = false
    const readyPromise = new Promise((resolve, reject) => { acknowledgeReady = resolve; rejectReady = reject })
    this.unsubscribe = this.store.subscribePending(() => {
      if (!ready) { ready = true; acknowledgeReady(true) }
      this.wake()
    }, (_error) => {
      this.onError({ code: 'event_subscription_failed' })
      if (!ready) { ready = true; rejectReady(eventError('event_subscription_start_failed')) }
      else for (let lane = 0; lane < this.concurrency; lane += 1) schedule(lane, 1_000)
    })
    this.readyAcknowledge = acknowledgeReady
    this.readyPromise = readyPromise
    this.wake()
    this.stopLoop = () => {
      stopped = true
      for (const timer of timers.values()) clearTimer(timer)
      timers.clear()
    }
    const acknowledged = await readyPromise
    if (acknowledged) this.onReady({ subscriptionCount: 1 })
  }

  async close() {
    this.closed = true
    this.stopLoop?.()
    this.readyAcknowledge?.(false)
    for (const controller of this.controllers) controller.abort(eventError('worker_shutdown'))
    try { this.unsubscribe?.() } finally { this.unsubscribe = null }
    await Promise.allSettled([...this.runTasks, ...this.inflight])
  }

  async #process(claim) {
    const eventId = claim.eventId
    let normalized
    try {
      if (claim.schemaVersion !== 1) throw eventError('unsupported_event_schema')
      if (claim.claimedEnvelopeEventId !== eventId) throw eventError('event_id_mismatch')
      normalized = await normalizeEducationEvent(claim)
    } catch (error) {
      await this.store.finish({ eventId, workerId: this.workerId, leaseToken: claim.leaseToken, fence: claim.fence,
        state: 'blocked', safeErrorCode: error?.safeCode ?? 'invalid_event_envelope', now: this.clock().toISOString() })
      return
    }
    const selected = this.handlers[normalized.eventType]
    const phases = Array.isArray(selected) ? selected.map((item, index) => [item.phase ?? `phase-${index}`, item.handle])
      : typeof selected === 'function' ? [[claim.eventType, selected]] : []
    let leaseLost = false
    const controller = new AbortController()
    this.controllers.add(controller)
    const heartbeat = setInterval(() => {
      if (this.closed || leaseLost) return
      void this.store.renew({ eventId, workerId: this.workerId, leaseToken: claim.leaseToken, fence: claim.fence,
        now: this.clock().toISOString(), leaseMs: this.leaseMs }).then((result) => { if (!result) leaseLost = true }, () => { leaseLost = true })
    }, Math.max(1_000, Math.floor(this.leaseMs / 3)))
    heartbeat.unref?.()
    try {
      let blocked = false
      let blockCode = null
      for (const [phase, handler] of phases) {
        if (claim.fanout?.[phase]?.state === 'complete') continue
        if (typeof handler !== 'function') continue
        if (this.closed) return
        const result = await runHandlerWithDeadline(handler, { ...claim, ...normalized },
          { controller, timeoutMs: this.handlerTimeoutMs })
        if (this.closed || leaseLost) return
        if (result?.state === 'blocked') { blocked = true; blockCode = safeCode({ safeCode: result.safeErrorCode }) }
        const checkpointed = await this.store.checkpoint({ eventId, workerId: this.workerId, leaseToken: claim.leaseToken,
          fence: claim.fence, phase, receipt: result?.receipt, now: this.clock().toISOString() })
        if (!checkpointed) throw eventError('stale_lease')
      }
      const unknown = phases.length === 0 || phases.every(([, handler]) => typeof handler !== 'function')
      const finished = await this.store.finish({ eventId, workerId: this.workerId, leaseToken: claim.leaseToken, fence: claim.fence,
        state: unknown || blocked ? 'blocked' : 'complete', safeErrorCode: unknown ? 'unsupported_event_action' : blockCode,
        now: this.clock().toISOString() })
      if (!finished) throw eventError('stale_lease')
    } catch (error) {
      if (error?.safeCode === 'stale_lease') return
      if (this.closed) return
      this.onError({ code: 'event_processing_failed', safeCode: safeCode(error) })
      if (claim.attempts >= this.maxAttempts) {
        const finished = await this.store.finish({ eventId, workerId: this.workerId, leaseToken: claim.leaseToken, fence: claim.fence,
          state: 'dead_letter', safeErrorCode: safeCode(error), now: this.clock().toISOString() })
        if (!finished) this.onError({ code: 'event_terminal_write_fenced' })
      } else {
        const delay = Math.min(60 * 60_000, this.retryBaseMs * (2 ** Math.min(claim.attempts - 1, 12)))
        const retried = await this.store.retry({ eventId, workerId: this.workerId, leaseToken: claim.leaseToken, fence: claim.fence,
          now: this.clock().toISOString(), nextAttemptAt: new Date(this.clock().valueOf() + delay).toISOString(), safeErrorCode: safeCode(error) })
        if (!retried) this.onError({ code: 'event_retry_write_fenced' })
      }
    }
    finally { clearInterval(heartbeat); this.controllers.delete(controller) }
  }
}

function runHandlerWithDeadline(handler, event, { controller, timeoutMs }) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = eventError('handler_deadline_exceeded')
      // The handler can stop transport/SDK work immediately; subsequent queue writes remain fenced.
      controller.abort(error)
      reject(error)
    }, timeoutMs)
    timer.unref?.()
  })
  const aborted = new Promise((_, reject) => {
    if (controller.signal.aborted) reject(controller.signal.reason ?? eventError('worker_shutdown'))
    else controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? eventError('worker_shutdown')), { once: true })
  })
  return Promise.race([Promise.resolve().then(() => handler(event, { signal: controller.signal })), deadline, aborted])
    .finally(() => clearTimeout(timer))
}

async function mutateOwned(db, ref, { workerId, leaseToken, fence }, now, mutate) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const row = snap.data() ?? {}
    if (!snap.exists || row.state !== 'processing' || row.leaseOwner !== workerId || row.leaseToken !== leaseToken || row.fence !== fence
      || millis(row.leaseUntil) <= Date.parse(now)) return false
    return mutate(tx, ref, row)
  })
}

function validRef(value) { return typeof value === 'string' && ID.test(value) }
function validOperationId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9_.:-]+$/.test(value) }
function assertSameEventIdentity(row = {}, event) {
  if (row.eventId !== event.eventId || row.familyId !== event.familyId || row.childId !== event.childId
    || row.source !== event.source || canonical(row.sourceRef) !== canonical(event.sourceRef)
    || row.eventType !== event.eventType || row.operationId !== event.operationId) throw new Error('event_identity_conflict')
}
function canonical(value) {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
function validActor(actor) { return actor?.type === 'user' ? validRef(actor.uid)
  : actor?.type === 'system' && typeof actor.id === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(actor.id) }
function normalizePhaseReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const receipt = {}
  for (const key of ['jobId', 'artifactId', 'eventId']) {
    if (typeof value[key] === 'string' && /^[a-f0-9]{64}$/.test(value[key])) receipt[key] = value[key]
  }
  if (typeof value.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)) {
    receipt.requestId = value.requestId
  }
  if (Number.isSafeInteger(value.generation) && value.generation >= 0) receipt.generation = value.generation
  return Object.keys(receipt).length ? receipt : null
}
function validSourceRef(ref) { return SOURCE_KINDS.has(ref?.kind) && validDocumentPath(ref.documentPath)
  && Object.keys(ref).every((key) => ['kind', 'documentPath', 'dayToken', 'recordId', 'quizToken', 'taskId'].includes(key))
  && ['dayToken', 'recordId', 'quizToken', 'taskId'].every((key) => ref[key] === undefined || validSourceSegment(ref[key])) }
function canonicalSourceRef(ref) { return Object.fromEntries(['kind', 'documentPath', 'dayToken', 'recordId', 'quizToken', 'taskId'].filter((key) => ref[key] !== undefined).map((key) => [key, ref[key]])) }
function safeMeshPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  for (const key of ['eventId', 'sourceEventKey', 'sourceRevision', 'scopeKey', 'occurredAt', 'detectedAt', 'privacyClass']) {
    if (typeof value[key] === 'string' && value[key].length <= 256) result[key] = value[key]
  }
  if (value.identityEncoding === 'sha256-v1') result.identityEncoding = value.identityEncoding
  const safeFields = {}
  for (const key of ['childName', 'subject', 'title', 'previousTitle', 'value', 'previousValue', 'occurredLabel', 'status', 'previousStatus', 'summary', 'nextStep']) {
    if (typeof value.fields?.[key] === 'string' && value.fields[key].length <= 500) safeFields[key] = redactMeshText(value.fields[key])
  }
  result.fields = safeFields
  if (value.workRef?.kind === 'day-task' && typeof value.workRef.id === 'string' && /^[a-f0-9]{64}$/.test(value.workRef.id)) result.workRef = { kind: 'day-task', id: value.workRef.id }
  if (Array.isArray(value.contextRefs)) result.contextRefs = value.contextRefs.filter((ref) => ref && ['day', 'task', 'grade'].includes(ref.kind)
    && typeof ref.id === 'string' && /^[a-f0-9]{64}$/.test(ref.id)).slice(0, 10).map(({ kind, id }) => ({ kind, id }))
  if (value.navigationContext?.kind === 'day' && typeof value.navigationContext.dayToken === 'string'
    && /^[a-f0-9]{64}$/.test(value.navigationContext.dayToken)) result.navigationContext = { kind: 'day', dayToken: value.navigationContext.dayToken }
  return result
}
// eslint-disable-next-line no-control-regex
function redactMeshText(value) { return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/https?:\/\/\S+/gi, '[ссылка скрыта]')
  .replace(/\b(?:token|secret|password|answer|key|ответы|ключ)[=: ]+\S+/gi, '[данные скрыты]').slice(0, 500) }
function validTime(value) {
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value ?? '')
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null
}
// eslint-disable-next-line no-control-regex
function validSourceSegment(value) { return typeof value === 'string' && value.length > 0 && value.length <= 500
  // eslint-disable-next-line no-control-regex -- Reject unsafe Firestore path segments.
  && value !== '.' && value !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(value) }
// eslint-disable-next-line no-control-regex
function validDocumentPath(value) { return typeof value === 'string' && value.length > 0 && value.length <= 500 && !value.startsWith('/')
  // eslint-disable-next-line no-control-regex -- Reject unsafe Firestore document paths.
  && !/[\\\u0000-\u001f\u007f]/.test(value) && value.split('/').every((part) => validSourceSegment(part)) }
function millis(value) { return typeof value?.toMillis === 'function' ? value.toMillis() : Date.parse(value ?? '') }
function safeCode(error) { return typeof error?.safeCode === 'string' && /^[a-z0-9_]{1,64}$/.test(error.safeCode) ? error.safeCode : 'handler_failed' }
function eventError(safeCode) { const error = new Error(safeCode); error.safeCode = safeCode; return error }
