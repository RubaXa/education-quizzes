import { createHash } from 'node:crypto'
import { diffCompleteSnapshots } from '../domain/diff.mjs'
import { EVENT_TYPES } from '../domain/events.mjs'

/** @see ../../../docs/services/telegram-bot/ports-and-events.md#контракт-observation @see ../../../docs/services/telegram-bot/adapters/firestore.md#подписка-и-обработка-сигнала */
export class SourcePipeline {
  constructor({ source, checkpoints, accept, mode = 'notify', workerId, clock = () => new Date(), leaseMs = 60_000,
    maxRecords = 2_000, maxPendingBytes = 512_000, setTimer = setTimeout, clearTimer = clearTimeout }) {
    if (!source || !['firestore', 'mesh'].includes(source.kind) || typeof source.scopeKey !== 'function' || typeof source.observe !== 'function' || typeof source.validateScope !== 'function') throw new Error('source_port_unavailable')
    if (!checkpoints || !['acquire', 'savePending', 'advance', 'renew', 'release', 'invalidateOwner'].every((method) => typeof checkpoints[method] === 'function')) throw new Error('checkpoint_port_unavailable')
    if (typeof accept !== 'function' || !['notify', 'shadow'].includes(mode) || !workerId) throw new Error('invalid_source_pipeline_config')
    if (!Number.isFinite(leaseMs) || leaseMs < 3 || typeof setTimer !== 'function' || typeof clearTimer !== 'function') throw new Error('invalid_source_pipeline_config')
    this.source = source
    this.checkpoints = checkpoints
    this.accept = accept
    this.mode = mode
    this.namespace = mode
    this.workerId = workerId
    this.clock = clock
    this.leaseMs = leaseMs
    this.maxRecords = maxRecords
    this.maxPendingBytes = maxPendingBytes
    this.setTimer = setTimer
    this.clearTimer = clearTimer
  }

  async process(scope, { origin = scope.origin ?? 'bootstrap', signal = null } = {}) {
    if (!['bootstrap', 'live'].includes(origin)) throw new Error('invalid_source_origin')
    assertRunning(signal)
    const scopeKey = this.source.scopeKey(scope)
    const namespace = this.namespace
    const ownerBinding = bindingFor(scope, this.source.kind)
    const lease = await this.checkpoints.acquire({ scopeKey, namespace, ownerBinding, workerId: this.workerId, now: this.clock().toISOString(), leaseMs: this.leaseMs })
    if (!lease?.acquired) return { status: 'busy', scopeKey }
    const args = { scopeKey, namespace, leaseToken: lease.leaseToken, version: lease.version }
    const heartbeat = createLeaseHeartbeat({ checkpoints: this.checkpoints, args, clock: this.clock, leaseMs: this.leaseMs,
      setTimer: this.setTimer, clearTimer: this.clearTimer })
    heartbeat.start()
    try {
      const validOwner = await this.source.validateScope(scope, { signal })
      assertRunning(signal)
      heartbeat.assertHealthy()
      if (!validOwner) {
        await heartbeat.stop()
        heartbeat.assertHealthy()
        await this.checkpoints.invalidateOwner({ ...args, now: this.clock().toISOString() })
        return { status: 'owner_changed', scopeKey }
      }
      if (lease.pending) return await this.#replayPending(scope, args, lease.pending, heartbeat, signal)

      const observation = await this.source.observe(scope, { signal })
      assertRunning(signal)
      heartbeat.assertHealthy()
      if (!observation || observation.completeness !== 'complete' || observation.source !== this.source.kind
        || observation.scopeKey !== scopeKey
        || observation.familyId !== scope.familyId || observation.childId !== scope.childId
        || typeof observation.scopeKey !== 'string' || !Array.isArray(observation.records)) {
        return incompleteResult(lease.sequence ?? 0, scopeKey)
      }
      const currentRecords = normalizeSourceRecords(observation.records)
      if (!currentRecords) return incompleteResult(lease.sequence ?? 0, scopeKey)
      if (currentRecords.length > this.maxRecords) return incompleteResult(lease.sequence ?? 0, scopeKey, 'source_snapshot_too_large')
      const sequence = (lease.sequence ?? 0) + 1
      const records = mergeKnownRecords(lease.baseline?.records ?? [], currentRecords)
      if (records.length > this.maxRecords) return incompleteResult(lease.sequence ?? 0, scopeKey, 'source_snapshot_too_large')
      const current = { complete: true, observationSequence: sequence, sourceProjectionVersion: 2, records }
      let events = []
      if (this.mode === 'notify' && (lease.baseline || origin === 'live')) {
        const priorRecords = lease.baseline?.records ?? []
        const priorByKey = new Map(priorRecords.map((record) => [record.recordKey, record]))
        const diffRecords = records.filter((record) => shouldDiffRecord(record, priorByKey.get(record.recordKey), {
          origin, previousProjectionVersion: lease.baseline?.sourceProjectionVersion ?? null,
        }))
        const previous = lease.baseline ?? { complete: true, observationSequence: 0, records: [] }
        const diff = diffCompleteSnapshots({ source: observation.source, scopeKey: observation.scopeKey, familyId: scope.familyId, childId: scope.childId,
          previous, current: { ...current, records: diffRecords }, detectedAt: this.clock().toISOString() })
        if (!diff.advanced) return incompleteResult(lease.sequence ?? 0, scopeKey)
        events = diff.events
      }
      const pending = { sequence, events, candidateBaseline: current, ownerBinding }
      if (Buffer.byteLength(JSON.stringify(pending)) > this.maxPendingBytes) return incompleteResult(lease.sequence ?? 0, scopeKey, 'source_snapshot_too_large')
      if (this.mode === 'shadow') {
        const stillValid = await this.source.validateScope(scope, { signal })
        assertRunning(signal)
        heartbeat.assertHealthy()
        if (!stillValid) {
          await heartbeat.stop()
          heartbeat.assertHealthy()
          await this.checkpoints.invalidateOwner({ ...args, now: this.clock().toISOString() })
          return { status: 'owner_changed', scopeKey }
        }
        await heartbeat.stop()
        heartbeat.assertHealthy()
        assertRunning(signal)
        await this.checkpoints.advance({ ...args, now: this.clock().toISOString(), sequence, baseline: current })
        return { status: 'advanced', sequence, events: 0, scopeKey }
      }
      assertRunning(signal)
      await this.checkpoints.savePending({ ...args, now: this.clock().toISOString(), pending })
      assertRunning(signal)
      return await this.#replayPending(scope, args, pending, heartbeat, signal, { initial: true })
    } finally {
      await heartbeat.stop()
      await this.checkpoints.release(args)
    }
  }

  async #replayPending(scope, args, pending, heartbeat, signal, { initial = false } = {}) {
    assertRunning(signal)
    const initialOwnerValid = await this.source.validateScope(scope, { signal })
    assertRunning(signal)
    heartbeat.assertHealthy()
    if (!initialOwnerValid) {
      await heartbeat.stop()
      heartbeat.assertHealthy()
      await this.checkpoints.invalidateOwner({ ...args, now: this.clock().toISOString() })
      return { status: 'owner_changed', scopeKey: args.scopeKey }
    }
    for (const event of pending.events ?? []) {
      const ownerValid = await this.source.validateScope(scope, { signal })
      assertRunning(signal)
      heartbeat.assertHealthy()
      if (!ownerValid) {
        await heartbeat.stop()
        heartbeat.assertHealthy()
        await this.checkpoints.invalidateOwner({ ...args, now: this.clock().toISOString() })
        return { status: 'owner_changed', scopeKey: args.scopeKey }
      }
      assertRunning(signal)
      await this.accept(event)
      assertRunning(signal)
    }
    const finalOwnerValid = await this.source.validateScope(scope, { signal })
    assertRunning(signal)
    heartbeat.assertHealthy()
    if (!finalOwnerValid) {
      await heartbeat.stop()
      heartbeat.assertHealthy()
      await this.checkpoints.invalidateOwner({ ...args, now: this.clock().toISOString() })
      return { status: 'owner_changed', scopeKey: args.scopeKey }
    }
    await heartbeat.stop()
    heartbeat.assertHealthy()
    assertRunning(signal)
    await this.checkpoints.advance({ ...args, now: this.clock().toISOString(), sequence: pending.sequence, baseline: pending.candidateBaseline })
    return { status: initial ? 'advanced' : 'replayed', sequence: pending.sequence, events: pending.events?.length ?? 0, scopeKey: args.scopeKey }
  }
}

function assertRunning(signal) {
  if (signal?.aborted) {
    const error = new Error('worker_shutdown')
    error.code = 'worker_shutdown'
    throw error
  }
}

function incompleteResult(sequence, scopeKey, reasonCode = 'source_snapshot_incomplete') {
  return { status: 'incomplete', sequence, scopeKey, reasonCode }
}

function createLeaseHeartbeat({ checkpoints, args, clock, leaseMs, setTimer, clearTimer }) {
  const intervalMs = Math.max(1, Math.floor(leaseMs / 3))
  let timer = null
  let inFlight = null
  let failure = null
  let stopped = false
  const schedule = () => {
    if (stopped || failure) return
    timer = setTimer(() => {
      timer = null
      if (stopped) return
      inFlight = Promise.resolve().then(() => checkpoints.renew({ ...args, now: clock().toISOString(), leaseMs }))
        .catch((error) => { failure = error })
        .finally(() => { inFlight = null; schedule() })
    }, intervalMs)
    timer?.unref?.()
  }
  return {
    start: schedule,
    assertHealthy() { if (failure) throw failure },
    async stop() {
      stopped = true
      if (timer !== null) clearTimer(timer)
      timer = null
      if (inFlight) await inFlight
    },
  }
}

export function normalizeSourceRecords(records) {
  const safe = []
  const seen = new Set()
  const fieldsByKind = {
    grade: new Set(['childName', 'subject', 'value', 'occurredLabel']),
    schedule: new Set(['childName', 'subject', 'title', 'occurredLabel']),
    assignment: new Set(['childName', 'subject', 'title', 'occurredLabel']),
    upload: new Set(['childName', 'subject', 'title', 'status', 'occurredLabel']),
    quiz: new Set(['childName', 'subject', 'title', 'status']),
    review: new Set(['childName', 'subject', 'status']),
    probe: new Set(),
  }
  for (const record of records) {
    if (!record || typeof record.recordKey !== 'string' || !/^[a-f0-9]{64}$/.test(record.recordKey)
      || !['grade', 'schedule', 'assignment', 'upload', 'quiz', 'review', 'probe'].includes(record.kind)
      || (record.eventType !== undefined && !EVENT_TYPE_SET.has(record.eventType))
      || (record.semanticHash !== undefined && !/^[a-f0-9]{64}$/.test(record.semanticHash))
      || (record.occurredAt !== undefined && (typeof record.occurredAt !== 'string' || Number.isNaN(Date.parse(record.occurredAt))))) return null
    if (seen.has(record.recordKey)) return null
    seen.add(record.recordKey)
    const allowedEvents = {
      grade: ['grade.created', 'grade.changed'],
      schedule: ['schedule.created', 'schedule.changed', 'schedule.cancelled'],
      assignment: ['homework.assigned', 'homework.changed', 'homework.cancelled'],
      upload: ['upload.confirmed'], quiz: ['quiz.started', 'quiz.submitted'], review: ['review.changed'],
      probe: ['technical.probe'],
    }
    if (record.eventType && !allowedEvents[record.kind].includes(record.eventType)) return null
    if (record.kind === 'quiz' && record.eventType
      && ((record.eventType === 'quiz.started' && record.fields?.status !== 'started')
        || (record.eventType === 'quiz.submitted' && record.fields?.status !== 'submitted'))) return null
    if (record.fields !== undefined && (!record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields)
      || Object.keys(record.fields).some((key) => !fieldsByKind[record.kind].has(key)))) return null
    const fields = {}
    for (const key of ['childName', 'subject', 'title', 'value', 'status', 'occurredLabel']) {
      const value = record.fields?.[key]
      if (typeof value === 'string' && value.length <= 500) fields[key] = sanitizeText(value)
      else if (value !== undefined) return null
    }
    safe.push({ recordKey: record.recordKey, kind: record.kind, ...(record.eventType ? { eventType: record.eventType } : {}), ...(record.occurredAt ? { occurredAt: record.occurredAt } : {}), ...(record.semanticHash ? { semanticHash: record.semanticHash } : {}), fields })
  }
  return safe
}

function shouldDiffRecord(record, before, { origin, previousProjectionVersion } = {}) {
  if (record.kind === 'upload') {
    // Upload projection v2 adds stable stored uploads and task context.
    // Existing baselines are enriched quietly. A legacy empty bootstrap is
    // migrated quietly once; live origin remains eligible for a new upload.
    if (before) return false
    return !(origin === 'bootstrap' && previousProjectionVersion !== 2)
  }
  if (record.kind === 'quiz') {
    if (!record.eventType) return false
    const rank = { not_started: 0, started: 1, submitted: 2 }
    const next = rank[record.fields?.status]
    const prior = rank[before?.fields?.status]
    return Number.isInteger(next) && (prior === undefined || next > prior)
  }
  if (record.eventType) return true
  return ['grade', 'schedule', 'assignment'].includes(record.kind)
}

function mergeKnownRecords(previous, current) {
  const result = new Map(previous.map((record) => [record.recordKey, record]))
  for (const record of current) {
    const old = result.get(record.recordKey)
    if (record.kind === 'quiz' && old) {
      const rank = { not_started: 0, started: 1, submitted: 2 }
      if ((rank[record.fields?.status] ?? -1) < (rank[old.fields?.status] ?? -1)) continue
    }
    result.set(record.recordKey, record)
  }
  return [...result.values()].sort((a, b) => a.recordKey.localeCompare(b.recordKey))
}

const EVENT_TYPE_SET = new Set(EVENT_TYPES)
function bindingFor(scope, sourceKind) {
  const digest = (value) => value ? createHash('sha256').update(value).digest('hex') : null
  return { source: sourceKind, familyId: scope.familyId, childId: scope.childId, kind: scope.kind,
    dayTokenHash: digest(scope.dayToken), recordIdHash: digest(scope.recordId), quizTokenHash: digest(scope.quizToken) }
}

function sanitizeText(value) {
  // Prevent source projections from persisting links, credentials, or control bytes in a checkpoint.
  // eslint-disable-next-line no-control-regex -- Remove source-controlled control bytes before checkpoint persistence.
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/https?:\/\/\S+/gi, '[ссылка скрыта]')
    .replace(/\b(?:token|secret|password|answer|key|ответы|ключ)[=: ]+\S+/gi, '[данные скрыты]').slice(0, 500)
}
