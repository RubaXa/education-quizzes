import { describe, expect, it, vi } from 'vitest'
import { createFirestoreEducationSyncStore, workEventDigest } from './education-sync-dispatcher.mjs'
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
  it('absorbs a burst while queued into the same first workflow claim, with no successor run', async () => {
    const { store } = setup()
    await store.recordMeshChange({ eventDigest: digest(1000), now: iso(), debounceUntil: iso() })
    const dispatch = await store.claim({ now: iso(1), workerId: 'worker-a' })
    await store.markQueued({ requestId: dispatch.requestId, workerId: dispatch.workerId, now: iso(2) })
    for (let n = 1001; n <= 1100; n++) {
      await store.recordMeshChange({ eventDigest: digest(n), now: iso(3), debounceUntil: iso(4) })
    }
    expect(await store.claim({ now: iso(5), workerId: 'worker-b' })).toBeNull()
    expect(await store.claimRequest({ requestId: dispatch.requestId, tokenHash: digest(1200), now: iso(6) }))
      .toEqual({ status: 'claimed' })
    expect(await store.read()).toMatchObject({ requestId: dispatch.requestId, generation: 101,
      sendingGeneration: 101, pendingKinds: [], sourceAttemptGeneration: 101 })
    expect(await store.completeClaim({ requestId: dispatch.requestId, tokenHash: digest(1200), now: iso(7) }))
      .toEqual({ status: 'completed' })
  })

  it('absorbs pending action bounds on first claim but never expands an expired claimed range', async () => {
    const { db, store } = setup()
    const requestId = '00000000-0000-4000-8000-000000000001'
    db.documents.set('educationSyncDispatch/current', { requestId, status: 'queued', generation: 12, coalesceBeforeClaim: true,
      sendingGeneration: 8, sendingKinds: ['mesh'], pendingKinds: ['action'],
      sendingActionAfterGeneration: 4, sendingActionThroughGeneration: 8,
      pendingActionAfterGeneration: 8, pendingActionThroughGeneration: 12 })
    await store.claimRequest({ requestId, tokenHash: digest(1201), now: iso() })
    expect(await store.read()).toMatchObject({ sendingGeneration: 12, sendingKinds: ['mesh', 'action'],
      sendingActionAfterGeneration: 4, sendingActionThroughGeneration: 12,
      pendingKinds: [], pendingActionThroughGeneration: null })
    await store.recordMeshChange({ eventDigest: digest(1202), now: iso(1), debounceUntil: iso(2) })
    await store.claimRequest({ requestId, tokenHash: digest(1203), now: iso(7 * 60 * 60_000) })
    expect(await store.read()).toMatchObject({ generation: 13, sendingGeneration: 12,
      sendingActionThroughGeneration: 12, pendingKinds: ['mesh'] })
  })

  it.each(['queued', 'sending', 'uncertain', 'running', 'blocked'])('does not schedule a new dispatch while %s holds the active request', async (status) => {
    const { db, store } = setup()
    db.documents.set('educationSyncDispatch/current', { status, generation: 1, sendingGeneration: 1,
      sendingKinds: ['work'], pendingKinds: [], retryAt: iso(60_000) })
    const accepted = await store.recordSourceChange({ eventDigest: digest(199), kind: 'work', now: iso(), debounceUntil: iso(20_000) })
    expect(accepted).toMatchObject({ status: 'accepted', generation: 2 })
    expect(accepted.nextDueAt).toBeUndefined()
    expect(await store.read()).toMatchObject({ status, pendingKinds: ['work'], retryAt: iso(60_000) })
  })

  it('durably deduplicates accepted events while coalescing new generations inside the debounce window', async () => {
    const { db, store } = setup()
    expect(await store.recordMeshChange({ eventDigest: digest(1), now: iso(), debounceUntil: iso(20_000) }))
      .toMatchObject({ status: 'accepted', nextDueAt: iso(20_000) })
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
    expect(await store.read()).toMatchObject({ status: 'pending', generation: 6, sendingGeneration: null,
      requestId: null, debounceUntil: iso(43_015) })
    const next = await store.claim({ now: iso(44_000), workerId: 'worker-b' })
    await store.recordMeshChange({ eventDigest: digest(16), now: iso(45_000), debounceUntil: iso(46_000) })
    await store.claimRequest({ requestId: next.requestId, tokenHash: digest(100), now: iso(47_000) })
    expect(await store.read()).toMatchObject({ sendingGeneration: 7, pendingKinds: [] })
    expect(await store.completeClaim({ requestId: next.requestId, tokenHash: digest(100), now: iso(48_000) }))
      .toEqual({ status: 'completed' })
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

  it('freezes work-only request classification and generation through retry while preserving later Mesh work', async () => {
    const { store } = setup()
    await store.recordSourceChange({ eventDigest: digest(81), kind: 'work', now: iso(), debounceUntil: iso(20_000) })
    const dispatch = await store.claim({ now: iso(21_000), workerId: 'worker-a' })
    expect(dispatch.workKinds).toEqual(['work'])
    await store.markUncertain({ requestId: dispatch.requestId, workerId: dispatch.workerId, now: iso(22_000), code: 'codex_timeout' })
    await store.recordSourceChange({ eventDigest: digest(82), kind: 'mesh', now: iso(23_000), debounceUntil: iso(43_000) })
    const retry = await store.claim({ now: iso(83_000), workerId: 'worker-b' })
    expect(retry).toMatchObject({ requestId: dispatch.requestId, generation: 1, workKinds: ['work'] })
    expect(await store.read()).toMatchObject({ sendingGeneration: 1, sendingKinds: ['work'], pendingKinds: ['mesh'] })
  })

  it('starts the next batch with its own kinds after completing the frozen batch', async () => {
    const { store } = setup()
    await store.recordSourceChange({ eventDigest: digest(91), kind: 'work', now: iso(), debounceUntil: iso(20_000) })
    const first = await store.claim({ now: iso(21_000), workerId: 'worker-a' })
    await store.claimRequest({ requestId: first.requestId, tokenHash: digest(92), now: iso(22_000) })
    await store.recordSourceChange({ eventDigest: digest(93), kind: 'mesh', now: iso(23_000), debounceUntil: iso(23_000) })
    await store.completeClaim({ requestId: first.requestId, tokenHash: digest(92), now: iso(24_000) })
    const second = await store.claim({ now: iso(25_000), workerId: 'worker-b' })
    expect(second).toMatchObject({ generation: 2, workKinds: ['mesh'] })
  })

  it('keeps work-only classification and later generations through fail, block, and explicit resume', async () => {
    const { store } = setup()
    await store.recordSourceChange({ eventDigest: digest(111), kind: 'work', now: iso(), debounceUntil: iso(20_000) })
    const first = await store.claim({ now: iso(21_000), workerId: 'worker-a' })
    await store.claimRequest({ requestId: first.requestId, tokenHash: digest(112), now: iso(21_500) })
    await store.failClaim({ requestId: first.requestId, tokenHash: digest(112), now: iso(22_000), retryAt: iso(23_000) })
    const retry = await store.claim({ now: iso(24_000), workerId: 'worker-b' })
    expect(retry).toMatchObject({ generation: 1, workKinds: ['work'] })
    await store.claimRequest({ requestId: retry.requestId, tokenHash: digest(113), now: iso(25_000) })
    await store.recordSourceChange({ eventDigest: digest(114), kind: 'mesh', now: iso(26_000), debounceUntil: iso(46_000) })
    await store.blockClaim({ requestId: retry.requestId, tokenHash: digest(113), reasonCode: 'manual_review_required', now: iso(27_000) })
    await store.resumeBlocked({ requestId: retry.requestId, now: iso(48_000) })
    const resumed = await store.claim({ now: iso(48_001), workerId: 'worker-c' })
    expect(resumed).toMatchObject({ requestId: retry.requestId, generation: 1, workKinds: ['work'] })
    expect(await store.read()).toMatchObject({ sendingGeneration: 1, sendingKinds: ['work'], pendingKinds: ['mesh'] })
  })

  it.each(['queued', 'running', 'uncertain'])('safely retries legacy %s request with missing kind metadata as Mesh, retaining later work', async (status) => {
    const { db, store } = setup()
    const legacyRequest = '01a150dc-e067-7cc2-b08f-f573bf83e6e3'
    db.documents.set('educationSyncDispatch/current', { status, generation: 5, requestId: legacyRequest,
      sendingGeneration: 3, ...(status === 'queued' ? { queuedAt: iso(-11 * 60_000) } : {}),
      ...(status === 'running' ? { workflowLeaseUntil: iso(-1) } : {}),
      ...(status === 'uncertain' ? { retryAt: iso(-1) } : {}) })
    await store.recordSourceChange({ eventDigest: digest(121), kind: 'work', now: iso(), debounceUntil: iso(20_000) })
    let claim = await store.claim({ now: iso(21_000), workerId: 'worker-a' })
    if (status !== 'uncertain') claim = await store.claim({ now: iso(21_001), workerId: 'worker-a' })
    expect(claim).toMatchObject({ requestId: legacyRequest, generation: 3, workKinds: ['mesh'] })
    expect(await store.read()).toMatchObject({ sendingGeneration: 3, sendingKinds: ['mesh'], pendingKinds: ['work'] })
    await store.claimRequest({ requestId: legacyRequest, tokenHash: digest(122), now: iso(22_000) })
    await store.completeClaim({ requestId: legacyRequest, tokenHash: digest(122), now: iso(23_000) })
    const next = await store.claim({ now: iso(44_000), workerId: 'worker-b' })
    expect(next).toMatchObject({ generation: 6, workKinds: ['work'] })
  })

  it('clears stale legacy sending metadata from a completed generation before accepting new work-only', async () => {
    const { db, store } = setup()
    db.documents.set('educationSyncDispatch/current', { status: 'completed', generation: 5, sendingGeneration: 5 })
    await store.recordSourceChange({ eventDigest: digest(131), kind: 'work', now: iso(), debounceUntil: iso(20_000) })
    const next = await store.claim({ now: iso(21_000), workerId: 'worker-a' })
    expect(next).toMatchObject({ generation: 6, workKinds: ['work'] })
  })

  it.each(['workflow-fail', 'spawn-fail'])('preserves a frozen work retry after a new Mesh event arrives during %s backoff', async (failure) => {
    const { store } = setup()
    await store.recordSourceChange({ eventDigest: digest(141), kind: 'work', now: iso(), debounceUntil: iso(20_000) })
    const first = await store.claim({ now: iso(21_000), workerId: 'worker-a' })
    if (failure === 'workflow-fail') {
      await store.claimRequest({ requestId: first.requestId, tokenHash: digest(142), now: iso(22_000) })
      await store.failClaim({ requestId: first.requestId, tokenHash: digest(142), now: iso(23_000), retryAt: iso(60_000) })
    } else {
      await store.fail({ requestId: first.requestId, workerId: first.workerId, now: iso(23_000), retryAt: iso(60_000) })
    }
    expect(await store.recordSourceChange({ eventDigest: digest(143), kind: 'mesh', now: iso(24_000), debounceUntil: iso(44_000) }))
      .toMatchObject({ status: 'accepted', nextDueAt: iso(60_000) })
    expect(await store.claim({ now: iso(59_999), workerId: 'worker-b' })).toBeNull()
    const retry = await store.claim({ now: iso(60_000), workerId: 'worker-b' })
    expect(retry).toMatchObject({ generation: 1, workKinds: ['work'] })
    expect(await store.read()).toMatchObject({ sendingGeneration: 1, sendingKinds: ['work'], pendingKinds: ['mesh'] })
  })

  it('deduplicates metadata revisions by immutable Firestore work identity and admits distinct work', async () => {
    const { store } = setup()
    const work = { source: 'firestore', eventType: 'upload.confirmed', scopeKey: digest(101), sourceEventKey: digest(102), eventId: digest(103) }
    const digestA = workEventDigest(work)
    const digestMetadataRevision = workEventDigest({ ...work, eventId: digest(104) })
    expect(digestMetadataRevision).toBe(digestA)
    expect(workEventDigest({ ...work, sourceEventKey: digest(105) })).not.toBe(digestA)
    await store.recordSourceChange({ eventDigest: digestA, kind: 'work', now: iso(), debounceUntil: iso(20_000) })
    expect(await store.recordSourceChange({ eventDigest: digestMetadataRevision, kind: 'work', now: iso(1), debounceUntil: iso(20_001) }))
      .toEqual({ status: 'duplicate' })
    expect((await store.read()).generation).toBe(1)
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
    const store = { recordSourceChange: vi.fn(), read: vi.fn(async () => null), claim: vi.fn(async () => null),
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
      requestId: dispatch.requestId, generation: 1, workKinds: ['mesh'],
    })
    expect(await store.read()).toMatchObject({ status: 'sending', sendingGeneration: 1, pendingKinds: ['mesh'] })
  })

  it('keeps the source block until worker claim and coalesces the new Mesh generation', async () => {
    const { db, store } = setup()
    const requestId = '01a150dc-e067-7cc2-b08f-f573bf83e6e3'
    db.documents.set('educationSyncDispatch/current', { status: 'blocked', generation: 1,
      requestId, sendingGeneration: 1, sendingKinds: ['mesh'], pendingKinds: [],
      blockedReasonCode: 'source_unavailable', blockedAt: iso(1_000) })

    expect(await store.recordMeshChange({ eventDigest: digest(201), now: iso(2_000), debounceUntil: iso(22_000) }))
      .toMatchObject({ status: 'accepted', generation: 2, nextDueAt: iso(22_000) })
    expect(await store.read()).toMatchObject({ status: 'blocked', generation: 2, requestId,
      sendingGeneration: 1, sendingKinds: ['mesh'], pendingKinds: ['mesh'], blockedReasonCode: 'source_unavailable' })

    const resumed = await store.claim({ now: iso(22_000), workerId: 'worker-b' })
    expect(resumed).toMatchObject({ generation: 2, workKinds: ['mesh'] })
    expect(resumed.requestId).not.toBe(requestId)
    await store.markQueued({ requestId: resumed.requestId, workerId: resumed.workerId, now: iso(22_000) })
    await store.claimRequest({ requestId: resumed.requestId, tokenHash: digest(202), now: iso(23_000) })
    expect(await store.completeClaim({ requestId: resumed.requestId, tokenHash: digest(202), now: iso(24_000) }))
      .toEqual({ status: 'completed' })
    expect(await store.read()).toMatchObject({ status: 'completed', generation: 2, pendingKinds: [] })
  })

  it('coalesces an explicit resume of a Mesh-only source-unavailable block through the latest Mesh generation', async () => {
    const { db, store } = setup()
    const requestId = '01a150dc-e067-7cc2-b08f-f573bf83e6e3'
    db.documents.set('educationSyncDispatch/current', { status: 'blocked', generation: 31,
      requestId, sendingGeneration: 19, sendingKinds: ['mesh'], pendingKinds: ['mesh'],
      sendingActionAfterGeneration: 18, sendingActionThroughGeneration: null,
      pendingActionAfterGeneration: 18, pendingActionThroughGeneration: null,
      actionAfterGeneration: 18, actionThroughGeneration: null,
      blockedReasonCode: 'source_unavailable', blockedAt: iso(1_000) })

    expect(await store.resumeBlocked({ requestId, now: iso(2_000) }))
      .toEqual({ status: 'pending', requestId })
    expect(await store.read()).toMatchObject({ status: 'pending', generation: 31, requestId,
      sendingGeneration: 31, sendingKinds: ['mesh'], pendingKinds: [], resumeTrigger: 'operator_resume_mesh_coalesced' })
    const resumed = await store.claim({ now: iso(2_000), workerId: 'worker-b' })
    expect(resumed).toMatchObject({ requestId, generation: 31, workKinds: ['mesh'] })
    await store.claimRequest({ requestId, tokenHash: digest(231), now: iso(3_000) })
    expect(await store.completeClaim({ requestId, tokenHash: digest(231), now: iso(4_000) }))
      .toEqual({ status: 'completed' })
    expect(await store.read()).toMatchObject({ status: 'completed', generation: 31, pendingKinds: [] })
  })

  it('does not auto-resume an ambiguous or non-source block on a new Mesh event', async () => {
    const cases = [
      { blockedReasonCode: 'permission_required', sendingKinds: ['mesh'], pendingKinds: [] },
      { blockedReasonCode: 'manual_review_required', sendingKinds: ['mesh'], pendingKinds: [] },
      { blockedReasonCode: 'source_unavailable', sendingKinds: ['mesh', 'work'], pendingKinds: ['mesh'] },
      { blockedReasonCode: 'source_unavailable', sendingKinds: ['mesh'], pendingKinds: ['work'] },
      { blockedReasonCode: 'source_unavailable', sendingKinds: ['mesh'], pendingKinds: [], sendingActionThroughGeneration: 1 },
      { blockedReasonCode: 'source_unavailable', sendingKinds: ['mesh'], pendingKinds: [], sendingActionAfterGeneration: null, sendingActionThroughGeneration: 18 },
      { blockedReasonCode: 'source_unavailable', sendingKinds: null, pendingKinds: [] },
    ]
    for (const [index, batch] of cases.entries()) {
      const { db, store } = setup()
      db.documents.set('educationSyncDispatch/current', { status: 'blocked', generation: 1,
        requestId: '01a150dc-e067-7cc2-b08f-f573bf83e6e3', sendingGeneration: 1,
        ...batch })
      await store.recordMeshChange({ eventDigest: digest(210 + index), now: iso(), debounceUntil: iso(20_000) })
      expect(await store.read()).toMatchObject({ status: 'blocked', generation: 2,
        blockedReasonCode: batch.blockedReasonCode })
    }
  })

  it('keeps a blocked request held when its new Mesh signal is a duplicate', async () => {
    const { db, store } = setup()
    db.documents.set('educationSyncDispatch/current', { status: 'blocked', generation: 1,
      requestId: '01a150dc-e067-7cc2-b08f-f573bf83e6e3', sendingGeneration: 1,
      sendingKinds: ['mesh'], pendingKinds: [], blockedReasonCode: 'source_unavailable' })
    db.documents.set(`educationSyncDispatchEvents/${digest(220)}`, { acceptedAt: iso() })
    expect(await store.recordMeshChange({ eventDigest: digest(220), now: iso(), debounceUntil: iso(20_000) }))
      .toEqual({ status: 'duplicate' })
    expect(await store.read()).toMatchObject({ status: 'blocked', generation: 1,
      blockedReasonCode: 'source_unavailable' })
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
