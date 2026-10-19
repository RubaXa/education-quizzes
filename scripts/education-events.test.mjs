import { describe, expect, it, vi } from 'vitest'
import { inspectEventQueue, main } from './education-events.mjs'

function fakeDb(rowsByState) {
  const calls = []
  const db = {
    collection(name) {
      expect(name).toBe('educationEvents')
      return {
        where(field, operator, value) { calls.push({ field, operator, value }); return this },
        orderBy(field, direction) { calls.push({ orderBy: field, direction }); return this },
        limit(count) { calls.push({ limit: count }); return this },
        async get() {
          const stateCall = [...calls].reverse().find((call) => call.field === 'state')
          const rows = stateCall ? rowsByState[stateCall.value] ?? [] : rowsByState.latest ?? []
          const limitCall = [...calls].reverse().find((call) => call.limit)
          return { docs: rows.slice(0, limitCall.limit).map((row) => ({ id: row.id, data: () => row.data })) }
        },
      }
    },
    collectionGroup() { throw new Error('source scans are forbidden') },
    doc() { throw new Error('document reads are forbidden') },
    batch() { throw new Error('writes are forbidden') },
    runTransaction() { throw new Error('transactions are forbidden') },
  }
  return { db, calls }
}

describe('education event queue status', () => {
  it('projects bounded read-only samples without private source, actor, or payload fields', async () => {
    const created = new Date('2026-10-19T10:00:00Z')
    const claimed = { seconds: 1792404300, nanoseconds: 0 }
    const row = { id: 'f'.repeat(64), data: { source: 'firestore', eventType: 'upload.confirmed', state: 'processing',
      createdAt: created, claimedAt: { toDate: () => new Date('2026-10-19T10:05:00Z') }, attempts: 3,
      safeErrorCode: 'retry_later', sourceRef: { documentPath: 'dayUploads/private-token/files/private-id' },
      familyId: 'private-family', childId: 'private-child', actor: { id: 'private-person', text: 'private actor' },
      payload: { studentName: 'private name' }, fanout: { education_sync: { state: 'complete', completedAt: claimed,
        taskId: 'private-task', detail: 'private value' } }, finishedAt: null } }
    const { db, calls } = fakeDb({ latest: [row], processing: [row] })
    const result = await inspectEventQueue(db)
    const serialized = JSON.stringify(result)
    expect(result.latest.events[0]).toMatchObject({ eventType: 'upload.confirmed', state: 'processing', attempts: 3,
      safeErrorCode: 'retry_later', latencyMs: { createdToClaimed: 300_000, createdToFinished: null } })
    expect(result.latest.events[0].fanout.education_sync.pointerHashes.taskId).toMatch(/^[a-f0-9]{20}$/)
    expect(result.latest.events[0].taskPointers[0].idHash).toMatch(/^[a-f0-9]{20}$/)
    for (const value of ['private-token', 'private-id', 'private-family', 'private-child', 'private-person', 'private actor', 'private name', 'private value', 'private-task']) {
      expect(serialized).not.toContain(value)
    }
    expect(calls.filter((call) => call.limit).map((call) => call.limit)).toEqual([101, 101, 101, 101, 101])
    expect(calls.some((call) => call.orderBy === 'createdAt' && call.direction === 'desc')).toBe(true)
  })

  it('handles empty queue and missing or malformed timestamps', async () => {
    const { db } = fakeDb({})
    const empty = await inspectEventQueue(db)
    expect(empty.latest).toEqual({ sampled: 0, truncated: false, events: [] })
    const result = await inspectEventQueue(fakeDb({ latest: [{ id: 'id', data: { state: 'unrecognized', eventType: 'unsafe',
      createdAt: { toDate() { throw new Error('corrupt') } }, attempts: -1, safeErrorCode: 'studentname' } }] }).db)
    expect(result.latest.events[0]).toMatchObject({ state: 'unknown', eventType: 'unknown', createdAt: null,
      claimedAt: null, finishedAt: null, attempts: null, safeErrorCode: null })
  })

  it('returns truncated samples when a bounded query has more than the display cap', async () => {
    const records = Array.from({ length: 101 }, (_, index) => ({ id: `evt-${index}`, data: { state: 'pending', createdAt: '2026-10-19T00:00:00Z' } }))
    const result = await inspectEventQueue(fakeDb({ latest: records, pending: records }).db)
    expect(result.latest).toMatchObject({ sampled: 100, truncated: true })
    expect(result.active.pending).toMatchObject({ sampled: 100, truncated: true })
    expect(result.active.processing.sampled).toBe(0)
  })

  it('main accepts only status and supports injected db/output', async () => {
    const { db } = fakeDb({})
    const write = vi.fn()
    expect(await main(['status'], { db, write })).toBe(0)
    expect(JSON.parse(write.mock.calls[0][0]).readOnly).toBe(true)
    expect(await main(['delete'], { db, write })).toBe(2)
  })

  it('resolves the configured project and terminates only the owned Firestore client', async () => {
    const { db } = fakeDb({})
    const terminate = vi.fn()
    db.terminate = terminate
    const dbFactory = vi.fn(() => db)
    const write = vi.fn()
    expect(await main(['status'], { root: '/no-local-credentials-read', env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'education-test' }, dbFactory, write }))
      .toBe(0)
    expect(dbFactory).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'education-test', cwd: '/no-local-credentials-read' }))
    expect(terminate).toHaveBeenCalledOnce()
  })
})
