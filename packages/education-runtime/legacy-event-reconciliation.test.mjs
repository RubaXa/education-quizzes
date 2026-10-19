import { describe, expect, it, vi } from 'vitest'
import { Timestamp } from '@google-cloud/firestore'
import { createLegacyEducationEventReconciler } from './legacy-event-reconciliation.mjs'
import { EDUCATION_EVENT_COLLECTION } from './event-queue.mjs'

function fixture({ items = [], pagesize = 25 } = {}) {
  const rows = new Map(items.map(({ path, data }) => [path, data]))
  const checkpointPath = 'educationEventReconciliation/legacyActions'
  const ref = (path) => ({ path, id: path.split('/').at(-1), async get() {
    const value = rows.get(path)
    return { exists: value !== undefined, ref: ref(path), id: path.split('/').at(-1), data: () => value, get: (key) => value?.[key] }
  } })
  const collections = new Map()
  const queryFor = (name, group = false) => {
    const filters = [], order = []
    let limit = Infinity, cursor = null
    const q = {
      where(field, op, value) { filters.push([field, op, value]); return q },
      orderBy(field) { order.push(field); return q },
      limit(value) { limit = value; return q },
      startAfter(timestamp, documentRef) { cursor = [timestamp, documentRef.path]; return q },
      async get() {
        let docs = [...rows].filter(([path]) => group ? path.split('/').at(-2) === 'items' : path.startsWith(`${name}/`))
          .map(([path, data]) => ({ id: path.split('/').at(-1), ref: ref(path), data: () => data, get: (key) => data[key] }))
          .filter((doc) => filters.every(([field, op, value]) => {
            const actual = field === '__name__' ? doc.ref.path : doc.get(field)
            if (op === '>=') return (actual?.toMillis?.() ?? actual) >= (value?.toMillis?.() ?? value)
            if (op === '>') return (actual?.toMillis?.() ?? actual) > (value?.toMillis?.() ?? value)
            if (op === '==') return actual === value
            return true
          }))
        docs.sort((a, b) => {
          for (const field of order) {
            const av = field === '__name__' ? a.ref.path : a.get(field)
            const bv = field === '__name__' ? b.ref.path : b.get(field)
            const delta = (av?.toMillis?.() ?? av ?? 0) < (bv?.toMillis?.() ?? bv ?? 0) ? -1
              : (av?.toMillis?.() ?? av ?? 0) > (bv?.toMillis?.() ?? bv ?? 0) ? 1 : 0
            if (delta) return delta
          }
          return 0
        })
        if (cursor) docs = docs.filter((doc) => doc.ref.path > cursor[1])
        return { docs: docs.slice(0, limit), empty: docs.length === 0 }
      },
    }
    return q
  }
  const db = {
    doc: ref,
    collectionGroup: (name) => queryFor(name, true),
    collection(name) {
      if (!collections.has(name)) collections.set(name, { doc: (id = 'auto') => ref(`${name}/${id}`), where: (...args) => queryFor(name).where(...args) })
      return collections.get(name)
    },
    async runTransaction(work) {
      const writes = []
      const tx = { get: (document) => document.get(), create: (document, data) => writes.push(['create', document.path, data]),
        update: (document, data) => writes.push(['update', document.path, data]) }
      const result = await work(tx)
      for (const [kind, path, data] of writes) {
        if (kind === 'create' && rows.has(path)) throw new Error('already_exists')
        rows.set(path, kind === 'update' ? { ...rows.get(path), ...data } : data)
      }
      return result
    },
  }
  const addDay = (day, task, { status = 'pending', checkedAt = null } = {}) => {
    rows.set(`dayOwners/${day}`, { familyId: 'family-1', childId: 'child-1' })
    rows.set(`dayPages/${day}`, { kind: 'student', subjects: [{ tasks: [{ id: task }] }] })
    if (status || checkedAt) rows.set(`dayProgress/${day}/items/${task}`, { status, checkedAt })
  }
  return { db, rows, addDay, checkpointPath, pagesize }
}

const stamp = (value) => Timestamp.fromDate(new Date(value))
const help = (day, task, requestText = '') => ({ path: `dayHelp/${day}/items/${task}`, data: {
  taskId: task, revision: 1, requestKind: 'step', requestText, requestedAt: stamp('2026-10-19T10:00:00.000Z'),
} })

describe('legacy Education event reconciliation', () => {
  it('keeps the cursor, retries a stale receipt with a new operation, and has no source subscriptions', async () => {
    const item = help('day-1', 'task-1')
    item.data.eventOperationId = 'old-action'
    item.data.eventReceiptId = 'a'.repeat(64)
    item.data.eventProducerVersion = 1
    const { db, rows, addDay, checkpointPath } = fixture({ items: [item] })
    addDay('day-1', 'task-1')
    rows.set(`educationEvents/${'a'.repeat(64)}`, { eventId: 'a'.repeat(64), eventType: 'help.requested',
      operationId: 'old-action', sourceRef: { documentPath: item.path }, createdAt: stamp('2026-10-18T10:00:00.000Z') })
    const publish = vi.fn(async (_db, event) => ({ eventId: event.operationId, created: true }))
    const bridge = createLegacyEducationEventReconciler({ db, publish, clock: () => Date.parse('2026-10-19T10:01:00.000Z'), pageSize: 1 })
    await bridge.runOne()
    expect(publish).toHaveBeenCalledOnce()
    expect(publish.mock.calls[0][1]).toMatchObject({ eventType: 'help.requested', operationId: expect.stringMatching(/^legacy-help:/) })
    expect(rows.get(checkpointPath).cursors.help).toMatchObject({ path: item.path })
    expect(() => db.doc(item.path).onSnapshot()).toThrow()
  })

  it('does not replay resolved help and still accepts valid empty-text help requests', async () => {
    const resolved = help('day-1', 'task-done', '');
    const pending = help('day-2', 'task-open', '');
    const { db, rows, addDay } = fixture({ items: [resolved, pending] })
    addDay('day-1', 'task-done', { status: 'verified', checkedAt: stamp('2026-10-19T11:00:00.000Z') })
    addDay('day-2', 'task-open')
    const publish = vi.fn(async () => ({ created: true }))
    const bridge = createLegacyEducationEventReconciler({ db, publish, clock: () => Date.parse('2026-10-19T12:00:00.000Z'), pageSize: 25 })
    await bridge.runOne()
    expect(publish).toHaveBeenCalledOnce()
    expect(publish.mock.calls[0][1].sourceRef.documentPath).toBe(pending.path)
    expect(publish.mock.calls[0][1].sourceRef.taskId).toBe('task-open')
    expect(rows.has('educationEvents/undefined')).toBe(false)
  })

  it('isolates a failed item, advances the page cursor, and retries it on the next pass', async () => {
    const first = help('day-1', 'task-1', 'bad source')
    const second = help('day-2', 'task-2', 'good source')
    const { db, rows, addDay } = fixture({ items: [first, second] })
    addDay('day-1', 'task-1')
    addDay('day-2', 'task-2')
    const logger = vi.fn()
    const publish = vi.fn(async (_db, event) => {
      if (event.sourceRef.documentPath === first.path && publish.mock.calls.length === 1) throw new Error('temporary')
      return { created: true }
    })
    const bridge = createLegacyEducationEventReconciler({ db, publish, logger, clock: () => Date.parse('2026-10-19T12:00:00.000Z'), pageSize: 2 })
    await bridge.runOne()
    const saved = rows.get('educationEventReconciliation/legacyActions')
    expect(saved.cursors.help.path).toBe(second.path)
    expect(saved.failedPaths.help).toContain(first.path)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(logger).toHaveBeenCalledWith({ code: 'legacy_event_item_retry', safeCode: 'event_publish_failed' })
    await bridge.runOne()
    expect(publish).toHaveBeenCalledTimes(3)
    expect(rows.get('educationEventReconciliation/legacyActions').failedPaths.help).not.toContain(first.path)
  })

  it('publishes unresolved quiz submit and follow-up events with the production queue writer', async () => {
    const submittedAt = stamp('2026-10-19T10:00:00.000Z')
    const followupRequestedAt = stamp('2026-10-19T10:01:00.000Z')
    const assignment = { path: 'assignments/quiz-1', data: {
      status: 'submitted', familyId: 'family-1', childId: 'child-1', submittedAt, followupRequestedAt,
      testId: 'test-1', questions: [{ id: 'q1', kind: 'long', points: 2 }], answers: { q1: 'Ответ' },
    } }
    const { db, rows } = fixture({ items: [assignment] })
    const logger = vi.fn()
    const bridge = createLegacyEducationEventReconciler({ db, logger,
      clock: () => Date.parse('2026-10-19T12:00:00.000Z') })

    await bridge.runOne()

    const published = [...rows.entries()].filter(([path]) => path.startsWith(`${EDUCATION_EVENT_COLLECTION}/`))
      .map(([, event]) => event.eventType).sort()
    expect(published).toEqual(['quiz.followup_requested', 'quiz.submitted'])
    expect(logger).not.toHaveBeenCalled()
  })

  it('does not publish auto-scored or already-reviewed quiz submissions', async () => {
    const submittedAt = stamp('2026-10-19T10:00:00.000Z')
    const autoScored = { path: 'assignments/auto-quiz', data: {
      status: 'submitted', familyId: 'family-1', childId: 'child-1', submittedAt,
      questions: [{ id: 'q1', kind: 'single-choice', points: 1 }], answers: { q1: 'a' },
    } }
    const reviewedManual = { path: 'assignments/manual-quiz', data: {
      status: 'submitted', familyId: 'family-1', childId: 'child-1', submittedAt,
      questions: [{ id: 'q2', kind: 'long', points: 2 }], answers: { q2: 'Ответ' },
    } }
    const { db, rows } = fixture({ items: [autoScored, reviewedManual] })
    rows.set('reviews/manual-quiz', { entries: { q2: { points: 2, explanation: 'Проверено' } } })
    const logger = vi.fn()
    const bridge = createLegacyEducationEventReconciler({ db, logger,
      clock: () => Date.parse('2026-10-19T12:00:00.000Z') })

    await bridge.runOne()

    expect([...rows.keys()].filter((path) => path.startsWith(`${EDUCATION_EVENT_COLLECTION}/`))).toEqual([])
    expect(logger).not.toHaveBeenCalled()
  })
})
