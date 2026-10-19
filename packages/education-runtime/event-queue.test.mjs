import { describe, expect, it, vi } from 'vitest'
import { Timestamp } from '@google-cloud/firestore'
import { createFirestoreEducationEventStore, EducationEventConsumer, normalizeEducationEvent, publishEducationEvent } from './event-queue.mjs'

function memoryDb() {
  const rows = new Map()
  const listeners = new Set()
  const queryReads = []
  const copy = (value) => value instanceof Timestamp ? value
    : Array.isArray(value) ? value.map(copy)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))
        : value
  const snap = (value) => ({ exists: value !== undefined, data: () => copy(value) })
  const collection = () => ({ doc(id) {
    const ref = { id }
    return { ...ref, get: async () => snap(rows.get(id)), ref,
      set: async (value) => { rows.set(id, copy(value)); notify() },
      update: async (value) => { rows.set(id, { ...rows.get(id), ...copy(value) }); notify() },
      create: async (value) => { if (rows.has(id)) throw new Error('exists'); rows.set(id, copy(value)); notify() } }
  }, where(field, operator, value) { return query().where(field, operator, value) } })
  const query = () => {
    const filters = []
    let order = null, max = Infinity, after = null
    const compare = (left, right) => (left?.toMillis?.() ?? Date.parse(left ?? '')) - (right?.toMillis?.() ?? Date.parse(right ?? ''))
    return {
    where(field, operator, value) { filters.push([field, operator, value]); return this },
    orderBy(field) { order = field; return this }, limit(count) { max = count; return this },
    startAfter(doc) { after = doc.id; return this },
    async get() {
      queryReads.push({ filters: [...filters], order, max })
      let docs = [...rows].map(([id, row]) => ({ id, ref: { id }, data: () => copy(row) }))
      docs = docs.filter((doc) => filters.every(([field, operator, value]) => {
        const actual = doc.data()[field]
        return operator === '==' ? actual === value
          : operator === '<=' ? compare(actual, value) <= 0 : operator === 'in' ? value.includes(actual) : true
      }))
      if (order) docs.sort((a, b) => compare(a.data()[order], b.data()[order]) || a.id.localeCompare(b.id))
      if (after) { const index = docs.findIndex((doc) => doc.id === after); if (index >= 0) docs = docs.slice(index + 1) }
      return { docs: docs.slice(0, max) }
    },
    onSnapshot(callback) { listeners.add(callback); callback({ docs: [] }); return () => listeners.delete(callback) },
  }}
  const notify = () => { for (const callback of listeners) callback({ docs: [] }) }
  const db = { collection, async runTransaction(callback) {
    const tx = { async get(ref) { return snap(rows.get(ref.id)) }, create(ref, value) { rows.set(ref.id, copy(value)); notify() },
      update(ref, value) { rows.set(ref.id, { ...rows.get(ref.id), ...copy(value) }); notify() } }
    return callback(tx)
  } }
  return { db, rows, listeners, queryReads }
}

const event = (overrides = {}) => ({ source: 'firestore', sourceRef: { kind: 'help', documentPath: 'dayHelp/day-1/items/task-1', dayToken: 'day-1', taskId: 'task-1' },
  familyId: 'family-1', childId: 'child-1', actor: { type: 'user', uid: 'parent-1' }, operationId: 'request-action-1',
  eventType: 'help.requested', createdAt: '2026-10-19T10:00:00.000Z', ...overrides })

describe('education event ingress and consumer', () => {
  it('normalizes deterministic IDs and deduplicates the same producer event', async () => {
    const { db, rows } = memoryDb()
    const first = await publishEducationEvent(db, event(), { timestamp: '2026-10-19T10:00:00.000Z' })
    const second = await publishEducationEvent(db, event(), { timestamp: '2026-10-19T10:00:00.000Z' })
    expect(second).toEqual({ ...first, created: false })
    expect(rows.size).toBe(1)
    expect((await normalizeEducationEvent(event())).state).toBe('pending')
  })

  it('keeps a second action on the same source as a distinct event', async () => {
    const { db, rows } = memoryDb()
    const first = await publishEducationEvent(db, event(), { timestamp: '2026-10-19T10:00:00.000Z' })
    const second = await publishEducationEvent(db, event({ operationId: 'request-action-2' }), { timestamp: '2026-10-19T10:00:00.000Z' })
    expect(second.eventId).not.toBe(first.eventId)
    expect(rows.size).toBe(2)
  })

  it('accepts an encoded non-ASCII source segment for a material requirement action', async () => {
    const { db, rows } = memoryDb()
    const recordId = encodeURIComponent('Физика 7')
    const sourceRef = { kind: 'material', recordId,
      documentPath: `families/family-1/children/child-1/bookRequirements/${recordId}` }
    await expect(publishEducationEvent(db, event({ eventType: 'material.requirement_changed', sourceRef,
      operationId: 'requirement-change-7' }), { timestamp: '2026-10-19T10:00:00.000Z' })).resolves.toMatchObject({ created: true })
    expect(rows.size).toBe(1)
  })

  it('uses one collection subscription and unsubscribes on shutdown', async () => {
    const { db, listeners } = memoryDb()
    const store = createFirestoreEducationEventStore(db)
    const consumer = new EducationEventConsumer({ store, handlers: {}, workerId: 'worker-1' })
    await consumer.start()
    expect(listeners.size).toBe(1)
    await consumer.close()
    expect(listeners.size).toBe(0)
  })

  it('rearms an idle timer immediately when the queue listener wakes', async () => {
    let wakeListener, nextTimerId = 0
    const timers = new Map(), setTimer = vi.fn((callback, delay) => {
      const timer = { id: ++nextTimerId, callback, delay }
      timer.fire = async () => { timers.delete(timer.id); await callback() }
      timers.set(timer.id, timer)
      return timer
    })
    const clearTimer = vi.fn((timer) => timers.delete(timer.id))
    const store = { subscribePending(callback) { wakeListener = callback; callback(); return () => {} }, async listReady() { return [] }, async claim() { return null } }
    const consumer = new EducationEventConsumer({ store, handlers: {}, workerId: 'wake-test' })
    await consumer.start({ setTimer, clearTimer })
    const first = [...timers.values()][0]
    await first.fire()
    const idle = [...timers.values()][0]
    expect(idle.delay).toBeGreaterThan(0)
    wakeListener()
    expect(clearTimer).toHaveBeenCalledWith(idle)
    expect([...timers.values()].some((timer) => timer.delay === 0)).toBe(true)
    await consumer.close()
  })

  it('drains more than one batch across unrelated families', async () => {
    const { db, rows, queryReads } = memoryDb()
    const store = createFirestoreEducationEventStore(db, { batchSize: 100 })
    for (let index = 0; index < 205; index += 1) {
      await publishEducationEvent(db, event({ familyId: `family-${index}`, childId: `child-${index}`, operationId: `op-${index}` }),
        { timestamp: '2026-10-19T10:00:00.000Z' })
    }
    const handled = new Set()
    const consumer = new EducationEventConsumer({ store, handlers: { 'help.requested': (item) => { handled.add(item.familyId) } },
      workerId: 'batch-worker', clock: () => new Date('2026-10-19T10:00:01.000Z'), concurrency: 1 })
    for (let index = 0; index < 205; index += 1) await consumer.runOne()
    expect(handled.size).toBe(205)
    expect([...rows.values()].every((row) => row.state === 'complete')).toBe(true)
    expect(queryReads.filter((read) => read.filters.some(([field]) => field === 'state')).length).toBeLessThanOrEqual(8)
  })

  it('does not let a future retry at the head of the pending queue block due work', async () => {
    const { db, rows } = memoryDb()
    const store = createFirestoreEducationEventStore(db)
    const future = await publishEducationEvent(db, event(), { timestamp: '2026-10-19T10:00:00.000Z' })
    const futureClaim = await store.claim({ eventId: future.eventId, workerId: 'worker-a', now: '2026-10-19T10:00:00.000Z', leaseMs: 60_000 })
    await store.retry({ eventId: future.eventId, workerId: 'worker-a', leaseToken: futureClaim.leaseToken, fence: futureClaim.fence,
      now: '2026-10-19T10:00:01.000Z', nextAttemptAt: '2026-10-19T10:05:00.000Z', safeErrorCode: 'temporary' })
    const due = await publishEducationEvent(db, event({ operationId: 'due-action' }), { timestamp: '2026-10-19T10:00:02.000Z' })
    const consumer = new EducationEventConsumer({ store, handlers: { 'help.requested': (item) => item.operationId }, workerId: 'worker-b',
      clock: () => new Date('2026-10-19T10:00:03.000Z') })
    await expect(consumer.runOne()).resolves.toBe(true)
    expect(rows.get(due.eventId).state).toBe('complete')
    expect(rows.get(future.eventId).state).toBe('pending')
  })

  it('fences stale workers and resumes from durable fanout checkpoints after a crash', async () => {
    const { db, rows } = memoryDb()
    const store = createFirestoreEducationEventStore(db)
    const { eventId } = await publishEducationEvent(db, event(), { timestamp: '2026-10-19T10:00:00.000Z' })
    const first = await store.claim({ eventId, workerId: 'worker-a', now: '2026-10-19T10:00:01.000Z', leaseMs: 10_000 })
    await store.checkpoint({ eventId, workerId: 'worker-a', leaseToken: first.leaseToken, fence: first.fence,
      phase: 'notify', receipt: { eventId, jobId: 'c'.repeat(64), sourceText: 'private response', requestId: 'not-a-request' },
      now: '2026-10-19T10:00:02.000Z' })
    expect(rows.get(eventId).fanout.notify).toMatchObject({ state: 'complete', receipt: { eventId, jobId: 'c'.repeat(64) } })
    expect(rows.get(eventId).fanout.notify.receipt).not.toHaveProperty('sourceText')
    await expect(store.finish({ eventId, workerId: 'worker-a', leaseToken: first.leaseToken, fence: first.fence,
      now: '2026-10-19T10:00:12.000Z' })).resolves.toBe(false)
    const done = vi.fn()
    const notify = vi.fn()
    const consumer = new EducationEventConsumer({ store, handlers: { 'help.requested': [
      { phase: 'notify', handle: notify }, { phase: 'sync', handle: done },
    ] }, workerId: 'worker-b', clock: () => new Date('2026-10-19T10:00:12.000Z') })
    await expect(consumer.runOne()).resolves.toBe(true)
    expect(notify).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledOnce()
    expect(rows.get(eventId).fanout.notify.state).toBe('complete')
    expect(rows.get(eventId).state).toBe('complete')
  })

  it('makes unsupported actions visible as blocked instead of dropping them', async () => {
    const { db, rows } = memoryDb()
    const store = createFirestoreEducationEventStore(db)
    const { eventId } = await publishEducationEvent(db, event({ eventType: 'material.ready', sourceRef: {
      kind: 'material', documentPath: 'families/family-1/children/child-1/bookUploads/book-1', recordId: 'book-1' } }),
    { timestamp: '2026-10-19T10:00:00.000Z' })
    const consumer = new EducationEventConsumer({ store, handlers: {}, workerId: 'worker-a', clock: () => new Date('2026-10-19T10:00:01.000Z') })
    await expect(consumer.runOne()).resolves.toBe(true)
    expect(rows.get(eventId)).toMatchObject({ state: 'blocked', safeErrorCode: 'unsupported_event_action' })
  })

  it('blocks future schema versions before invoking a handler', async () => {
    const { db, rows } = memoryDb()
    const store = createFirestoreEducationEventStore(db)
    const { eventId } = await publishEducationEvent(db, event(), { timestamp: '2026-10-19T10:00:00.000Z' })
    rows.get(eventId).schemaVersion = 99
    const handler = vi.fn()
    const consumer = new EducationEventConsumer({ store, handlers: { 'help.requested': handler }, workerId: 'worker-a',
      clock: () => new Date('2026-10-19T10:00:01.000Z') })
    await consumer.runOne()
    expect(handler).not.toHaveBeenCalled()
    expect(rows.get(eventId)).toMatchObject({ state: 'blocked', safeErrorCode: 'unsupported_event_schema' })
  })

  it('blocks an envelope whose stored ID does not match its Firestore document ID', async () => {
    const { db, rows } = memoryDb()
    const store = createFirestoreEducationEventStore(db)
    const { eventId } = await publishEducationEvent(db, event(), { timestamp: '2026-10-19T10:00:00.000Z' })
    rows.get(eventId).eventId = 'b'.repeat(64)
    const handler = vi.fn()
    const consumer = new EducationEventConsumer({ store, handlers: { 'help.requested': handler }, workerId: 'worker-a',
      clock: () => new Date('2026-10-19T10:00:01.000Z') })
    await consumer.runOne()
    expect(handler).not.toHaveBeenCalled()
    expect(rows.get(eventId)).toMatchObject({ state: 'blocked', safeErrorCode: 'event_id_mismatch' })
  })

  it('does not run a later phase after a durable checkpoint loses its lease', async () => {
    const { db } = memoryDb()
    const store = createFirestoreEducationEventStore(db)
    await publishEducationEvent(db, event(), { timestamp: '2026-10-19T10:00:00.000Z' })
    const nextPhase = vi.fn()
    const checkpoint = vi.spyOn(store, 'checkpoint').mockResolvedValueOnce(false)
    const consumer = new EducationEventConsumer({ store, handlers: { 'help.requested': [
      { phase: 'notify', handle: () => ({}) }, { phase: 'sync', handle: nextPhase },
    ] }, workerId: 'worker-a', clock: () => new Date('2026-10-19T10:00:01.000Z') })
    await consumer.runOne()
    expect(checkpoint).toHaveBeenCalledOnce()
    expect(nextPhase).not.toHaveBeenCalled()
  })

  it('processes another family while one bounded server action is still running', async () => {
    const { db, rows } = memoryDb()
    const store = createFirestoreEducationEventStore(db)
    const slow = await publishEducationEvent(db, event({ familyId: 'family-slow', childId: 'child-slow', operationId: 'slow-op' }),
      { timestamp: '2026-10-19T10:00:00.000Z' })
    const fast = await publishEducationEvent(db, event({ familyId: 'family-fast', childId: 'child-fast', operationId: 'fast-op',
      createdAt: '2026-10-19T10:00:00.001Z' }), { timestamp: '2026-10-19T10:00:00.001Z' })
    let releaseSlow
    const slowGate = new Promise((resolve) => { releaseSlow = resolve })
    let sawFast
    const fastSeen = new Promise((resolve) => { sawFast = resolve })
    let slowFinished = false
    const consumer = new EducationEventConsumer({ store, handlers: { 'help.requested': async (item) => {
      if (item.familyId === 'family-slow') { await slowGate; slowFinished = true }
      else sawFast()
    } }, workerId: 'concurrent-worker', clock: () => new Date('2026-10-19T10:00:01.000Z'), concurrency: 2 })
    await consumer.start()
    await fastSeen
    expect(slowFinished).toBe(false)
    releaseSlow()
    await vi.waitFor(() => {
      expect(rows.get(slow.eventId).state).toBe('complete')
      expect(rows.get(fast.eventId).state).toBe('complete')
    })
    await consumer.close()
    expect(rows.get(slow.eventId).state).toBe('complete')
    expect(rows.get(fast.eventId).state).toBe('complete')
  })
})
