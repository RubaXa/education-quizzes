import { describe, expect, it, vi } from 'vitest'
import { createFirestoreEducationSyncStore } from './education-sync-dispatcher.mjs'
import { EducationSyncDispatcher } from './education-sync-dispatcher.mjs'

class TransactionalFirestoreFake {
  documents = new Map()
  tail = Promise.resolve()

  collection(name) {
    return { doc: (id) => this.reference(`${name}/${id}`) }
  }

  reference(path) {
    return {
      path,
      async get() { return snapshot(path, this.database.documents.get(path)) },
      database: this,
    }
  }

  async runTransaction(work) {
    const previous = this.tail
    let release
    this.tail = new Promise((resolve) => { release = resolve })
    await previous
    try {
      const writes = []
      const tx = {
        async get(ref) { return snapshot(ref.path, thisDb.documents.get(ref.path)) },
        set(ref, value) { writes.push({ kind: 'set', path: ref.path, value: structuredClone(value) }) },
        create(ref, value) { writes.push({ kind: 'create', path: ref.path, value: structuredClone(value) }) },
      }
      const thisDb = this
      const result = await work(tx)
      for (const write of writes) {
        if (write.kind === 'create' && this.documents.has(write.path)) throw new Error('already_exists')
        this.documents.set(write.path, write.value)
      }
      return result
    } finally { release() }
  }
}

function snapshot(path, value) {
  return { ref: { path }, exists: value !== undefined, data: () => value === undefined ? undefined : structuredClone(value) }
}

function setup() {
  const db = new TransactionalFirestoreFake()
  const store = createFirestoreEducationSyncStore(db)
  return { db, store }
}

const base = Date.parse('2026-10-19T10:00:00.000Z')
const iso = (offsetMs = 0) => new Date(base + offsetMs).toISOString()
const digest = (n) => n.toString(16).padStart(64, '0')

describe('Firestore EducationSync dispatch store state machine', () => {
  it('durably deduplicates accepted events while coalescing new generations inside the debounce window', async () => {
    const { db, store } = setup()
    await store.recordMeshChange({ eventDigest: digest(1), now: iso(), debounceUntil: iso(20_000) })
    await store.recordMeshChange({ eventDigest: digest(2), now: iso(5_000), debounceUntil: iso(25_000) })
    const duplicateResults = await Promise.all([1, 2].map(() => store.recordMeshChange({
      eventDigest: digest(2), now: iso(6_000), debounceUntil: iso(26_000),
    })))
    expect(duplicateResults).toEqual([{ status: 'duplicate' }, { status: 'duplicate' }])
    await store.recordMeshChange({ eventDigest: digest(3), now: iso(6_000), debounceUntil: iso(26_000) })

    expect((await store.read())).toMatchObject({ status: 'pending', generation: 3, changedAt: iso(6_000), debounceUntil: iso(26_000) })
    expect(db.documents.has(`educationSyncDispatchEvents/${digest(1)}`)).toBe(true)
    expect(db.documents.has(`educationSyncDispatchEvents/${digest(2)}`)).toBe(true)
    expect(db.documents.has(`educationSyncDispatchEvents/${digest(3)}`)).toBe(true)
    expect(await store.claim({ now: iso(25_999), workerId: 'worker-a' })).toBeNull()
    expect(await store.claim({ now: iso(26_000), workerId: 'worker-a' })).toMatchObject({ generation: 3 })
  })

  it('leaves five changes received during a running request pending after that request completes', async () => {
    const { store } = setup()
    await store.recordMeshChange({ eventDigest: digest(10), now: iso(), debounceUntil: iso(20_000) })
    const claimed = await store.claim({ now: iso(21_000), workerId: 'worker-a' })
    expect(claimed).toMatchObject({ generation: 1 })
    await store.claimRequest({ requestId: claimed.requestId, tokenHash: digest(99), now: iso(22_000) })
    for (let n = 11; n < 16; n += 1) {
      await store.recordMeshChange({ eventDigest: digest(n), now: iso(23_000 + n), debounceUntil: iso(43_000 + n) })
    }
    expect(await store.completeClaim({ requestId: claimed.requestId, tokenHash: digest(99), now: iso(30_000) }))
      .toEqual({ status: 'pending' })
    expect(await store.read()).toMatchObject({ status: 'pending', generation: 6, sendingGeneration: 1,
      requestId: null, debounceUntil: iso(43_015) })
  })

  it('reuses the same request ID after an uncertain queue acknowledgement and ignores stale queue success', async () => {
    const { store } = setup()
    await store.recordMeshChange({ eventDigest: digest(20), now: iso(), debounceUntil: iso(20_000) })
    const first = await store.claim({ now: iso(21_000), workerId: 'worker-a' })
    await store.markUncertain({ requestId: first.requestId, workerId: first.workerId, now: iso(22_000), code: 'codex_timeout' })
    const waiting = await store.claim({ now: iso(60_000), workerId: 'worker-a' })
    expect(waiting).toBeNull()
    const retry = await store.claim({ now: iso(83_000), workerId: 'worker-b' })
    expect(retry.requestId).toBe(first.requestId)
    await store.claimRequest({ requestId: retry.requestId, tokenHash: digest(98), now: iso(84_000) })
    await store.markQueued({ requestId: first.requestId, workerId: first.workerId, now: iso(84_500) })
    expect(await store.read()).toMatchObject({ status: 'running' })
    await store.completeClaim({ requestId: retry.requestId, tokenHash: digest(98), now: iso(85_000) })
    await store.markQueued({ requestId: first.requestId, workerId: first.workerId, now: iso(86_000) })
    expect(await store.read()).toMatchObject({ status: 'completed', completedRequestId: first.requestId })
  })

  it('prevents duplicate request claims and invalidates the expired workflow token after recovery', async () => {
    const { store } = setup()
    await store.recordMeshChange({ eventDigest: digest(30), now: iso(), debounceUntil: iso(20_000) })
    const dispatch = await store.claim({ now: iso(21_000), workerId: 'worker-a' })
    expect(await store.claimRequest({ requestId: dispatch.requestId, tokenHash: digest(31), now: iso(22_000) }))
      .toEqual({ status: 'claimed' })
    expect(await store.claimRequest({ requestId: dispatch.requestId, tokenHash: digest(32), now: iso(23_000) }))
      .toEqual({ status: 'running' })
    expect(await store.completeClaim({ requestId: dispatch.requestId, tokenHash: digest(31), now: iso(6 * 60 * 60_000 + 23_000) }))
      .toEqual({ status: 'invalid_claim' })

    expect(await store.claim({ now: iso(6 * 60 * 60_000 + 24_000), workerId: 'worker-b' })).toBeNull()
    const retry = await store.claim({ now: iso(6 * 60 * 60_000 + 25_000), workerId: 'worker-b' })
    expect(retry.requestId).toBe(dispatch.requestId)
    expect(await store.claimRequest({ requestId: retry.requestId, tokenHash: digest(33), now: iso(6 * 60 * 60_000 + 26_000) }))
      .toEqual({ status: 'claimed' })
    expect(await store.completeClaim({ requestId: retry.requestId, tokenHash: digest(31), now: iso(6 * 60 * 60_000 + 27_000) }))
      .toEqual({ status: 'invalid_claim' })
  })

  it('does not let a late queue acknowledgement from before block/resume claim the resumed dispatch', async () => {
    const { store } = setup()
    await store.recordMeshChange({ eventDigest: digest(40), now: iso(), debounceUntil: iso(20_000) })
    const original = await store.claim({ now: iso(21_000), workerId: 'worker-a' })
    await store.claimRequest({ requestId: original.requestId, tokenHash: digest(41), now: iso(22_000) })
    await store.blockClaim({ requestId: original.requestId, tokenHash: digest(41), reasonCode: 'permission_required', now: iso(23_000) })
    await store.recordMeshChange({ eventDigest: digest(42), now: iso(24_000), debounceUntil: iso(44_000) })
    await store.resumeBlocked({ requestId: original.requestId, now: iso(45_000) })
    const resumed = await store.claim({ now: iso(45_001), workerId: 'worker-b' })
    expect(resumed.requestId).toBe(original.requestId)

    // This acknowledgement belongs to the original queue attempt, but requestId
    // is intentionally stable across resume and the replacement attempt is sending.
    await store.markQueued({ requestId: original.requestId, workerId: original.workerId, now: iso(45_002) })
    await store.markUncertain({ requestId: original.requestId, workerId: original.workerId, now: iso(45_003), code: 'codex_timeout' })
    expect(await store.fail({ requestId: original.requestId, workerId: original.workerId, now: iso(45_004), retryAt: iso(90_000) }))
      .toEqual({ status: 'stale_request' })
    expect(await store.read()).toMatchObject({ status: 'sending' })
  })

  it('returns idle without spawning or immediately requeueing when there is no due work', async () => {
    const store = { recordMeshChange: vi.fn(), read: vi.fn(async () => null), claim: vi.fn(async () => null),
      markQueued: vi.fn(), markUncertain: vi.fn(), fail: vi.fn(), claimRequest: vi.fn() }
    const spawnProcess = vi.fn()
    const dispatcher = new EducationSyncDispatcher({ store, threadId: '01a150dc-e067-7cc2-b08f-f573bf83e6e3',
      codexPath: '/opt/codex', projectRoot: '/workspace/PETR', spawnProcess })
    expect(await dispatcher.runOne()).toBe(false)
    expect(await dispatcher.runOne()).toBe(false)
    expect(store.claim).toHaveBeenCalledTimes(2)
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('holds a blocked request and new source generations until explicit resume', async () => {
    const { store } = setup()
    await store.recordMeshChange({ eventDigest: digest(40), now: iso(), debounceUntil: iso(20_000) })
    const dispatch = await store.claim({ now: iso(21_000), workerId: 'worker-a' })
    await store.claimRequest({ requestId: dispatch.requestId, tokenHash: digest(41), now: iso(22_000) })
    expect(await store.blockClaim({ requestId: dispatch.requestId, tokenHash: digest(41),
      reasonCode: 'permission_required', now: iso(23_000) })).toEqual({ status: 'blocked', reasonCode: 'permission_required' })

    await store.recordMeshChange({ eventDigest: digest(42), now: iso(30_000), debounceUntil: iso(50_000) })
    expect(await store.read()).toMatchObject({ status: 'blocked', generation: 2, requestId: dispatch.requestId,
      blockedReasonCode: 'permission_required' })
    expect(await store.claim({ now: iso(60_000), workerId: 'worker-a' })).toBeNull()
    expect(await store.claimRequest({ requestId: dispatch.requestId, tokenHash: digest(43), now: iso(31_000) }))
      .toEqual({ status: 'blocked' })
    expect(await store.heartbeatClaim({ requestId: dispatch.requestId, tokenHash: digest(41), now: iso(32_000) }))
      .toEqual({ status: 'invalid_claim' })
    expect(await store.failClaim({ requestId: dispatch.requestId, tokenHash: digest(41), now: iso(33_000), retryAt: iso(90_000) }))
      .toEqual({ status: 'invalid_claim' })
    expect(await store.completeClaim({ requestId: dispatch.requestId, tokenHash: digest(41), now: iso(34_000) }))
      .toEqual({ status: 'invalid_claim' })
    await store.markQueued({ requestId: dispatch.requestId, workerId: dispatch.workerId, now: iso(35_000) })
    expect(await store.read()).toMatchObject({ status: 'blocked', generation: 2 })

    expect(await store.resumeBlocked({ requestId: dispatch.requestId, now: iso(60_000) }))
      .toEqual({ status: 'pending', requestId: dispatch.requestId })
    expect(await store.claim({ now: iso(60_000), workerId: 'worker-a' })).toMatchObject({
      requestId: dispatch.requestId, generation: 2,
    })
    expect(await store.read()).toMatchObject({ status: 'sending', sendingGeneration: 2 })
  })

  it('rejects a block with an unrecognized reason or an expired claim', async () => {
    const { store } = setup()
    await store.recordMeshChange({ eventDigest: digest(50), now: iso(), debounceUntil: iso(20_000) })
    const dispatch = await store.claim({ now: iso(21_000), workerId: 'worker-a' })
    await store.claimRequest({ requestId: dispatch.requestId, tokenHash: digest(51), now: iso(22_000) })
    expect(await store.blockClaim({ requestId: dispatch.requestId, tokenHash: digest(51),
      reasonCode: 'arbitrary text', now: iso(23_000) })).toEqual({ status: 'invalid_reason' })
    expect(await store.blockClaim({ requestId: dispatch.requestId, tokenHash: digest(51),
      reasonCode: 'permission_required', now: iso(6 * 60 * 60_000 + 23_000) })).toEqual({ status: 'invalid_claim' })
  })
})
