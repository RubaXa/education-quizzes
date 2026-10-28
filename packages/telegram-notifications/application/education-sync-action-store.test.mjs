import { describe, expect, it } from 'vitest'
import { createFirestoreEducationSyncStore } from './education-sync-dispatcher.mjs'

class FakeDb {
  rows = new Map()
  collection(name) {
    return { doc: (id) => ({ path: `${name}/${id}`, id, get: async () => this.snapshot(`${name}/${id}`) }),
      where: (...args) => this.query(name).where(...args) }
  }
  doc(path) { return { path, id: path.split('/').at(-1), get: async () => this.snapshot(path) } }
  snapshot(path) { const value = this.rows.get(path); return { exists: value !== undefined, data: () => value } }
  query(name) {
    const filters = []; let limit = Infinity
    const query = {
      where(field, op, value) { filters.push([field, op, value]); return query },
      orderBy() { return query }, limit(value) { limit = value; return query },
      startAfter(generation, id) { filters.push(['__after', generation, id]); return query },
      get: async () => {
        let docs = [...this.rows].filter(([path]) => path.startsWith(`${name}/`)).map(([path, value]) => ({ id: path.split('/').at(-1), data: () => value }))
        docs = docs.filter((doc) => filters.every(([field, op, value]) => {
          if (field === '__after') return doc.data().generation > op || (doc.data().generation === op && doc.id > value)
          const actual = doc.data()[field]
          return op === '==' ? actual === value : op === '>' ? actual > value : op === '<=' ? actual <= value : true
        }))
        docs.sort((a, b) => a.data().generation - b.data().generation || a.id.localeCompare(b.id))
        return { docs: docs.slice(0, limit) }
      },
    }
    return query
  }
  async runTransaction(work) {
    const writes = []
    const tx = { get: async (ref) => this.snapshot(ref.path),
      create: (ref, value) => writes.push([ref.path, value]), set: (ref, value) => writes.push([ref.path, value]) }
    const result = await work(tx)
    for (const [path, value] of writes) this.rows.set(path, value)
    return result
  }
}

const event = (id, eventType = 'help.requested') => ({ eventId: id.toString(16).padStart(64, '0'), eventType,
  familyId: 'family-1', childId: 'child-1', source: 'firestore', sourceRef: {
    kind: 'help', documentPath: 'dayHelp/day-1/items/task-1', dayToken: 'day-1', taskId: 'task-1' } })
const artifact = (id) => ({ artifactPath: `operatorSyncTaskArtifacts/${id.toString(16).padStart(64, '0')}`,
  observationPath: `operatorSyncTaskObservations/${id.toString(16).padStart(64, '0')}`, fingerprint: id.toString(16).padStart(64, '0') })
const now = '2026-10-19T10:00:00.000Z'

describe('typed EducationSync action batch', () => {
  it('processes later Firebase actions while retaining an older missing-source block', async () => {
    const db = new FakeDb(), store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'mesh-block', generation: 232,
      sendingGeneration: 231, sendingKinds: ['mesh', 'action'], sendingActionThroughGeneration: 231,
      completedActionGeneration: 43, blockedReasonCode: 'source_unavailable', pendingActionAfterGeneration: 231, pendingActionThroughGeneration: 232, debounceUntil: now,
      actionLane: { requestId: 'old-action', status: 'blocked', blockedReasonCode: 'manual_review_required', actionAfterGeneration: 43, actionThroughGeneration: 231 } })
    db.rows.set('educationSyncDispatchEvents/later', { kind: 'action', taskKind: 'review-work', generation: 232, jobId: 'later-job', eventId: 'later' })
    db.rows.set('operatorSyncJobs/later-job', { status: 'queued' })
    const lane = await store.claim({ now, workerId: 'later-worker' })
    expect(lane).toMatchObject({ workKinds: ['action'], actionAfterGeneration: 231, actionThroughGeneration: 232 })
    expect((await store.read()).actionBlockHistory).toMatchObject([{ requestId: 'old-action', reason: 'manual_review_required' }])
    await store.markQueued({ requestId: lane.requestId, workerId: lane.workerId, now })
    await store.claimRequest({ requestId: lane.requestId, tokenHash: 'later-token', now })
    expect(await store.completeClaim({ requestId: lane.requestId, tokenHash: 'later-token', now })).toEqual({ status: 'incomplete_actions' })
    db.rows.get('operatorSyncJobs/later-job').status = 'done'
    expect(await store.completeClaim({ requestId: lane.requestId, tokenHash: 'later-token', now })).toEqual({ status: 'completed', scope: 'action' })
    expect(await store.read()).toMatchObject({ status: 'blocked', completedActionGeneration: 43, actionLane: { status: 'completed', gapPrior: true } })
    await store.recordAction({ event: event(233), kind: 'triage-help', artifact: artifact(233), now, debounceUntil: now })
    const next = await store.claim({ now, workerId: 'next-worker' })
    expect(next).toMatchObject({ workKinds: ['action'], actionAfterGeneration: 232, actionThroughGeneration: 233 })
    expect((await store.read()).actionBlockHistory).toHaveLength(1)
  })

  it('dispatches a frozen Firebase batch independently when a mixed source request is blocked', async () => {
    const db = new FakeDb(), store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'mesh-block', generation: 231,
      sendingGeneration: 231, sendingKinds: ['mesh', 'action'], sendingActionAfterGeneration: 43, sendingActionThroughGeneration: 231,
      completedActionGeneration: 43, blockedReasonCode: 'source_unavailable', actionLane: { status: 'superseded' } })
    const lane = await store.claim({ now, workerId: 'action-worker' })
    expect(lane).toMatchObject({ workKinds: ['action'], actionAfterGeneration: 43, actionThroughGeneration: 231, independentSourceBlock: true })
    expect(db.rows.get('educationSyncDispatch/current')).toMatchObject({ status: 'blocked', requestId: 'mesh-block', blockedReasonCode: 'source_unavailable', actionLane: { requestId: lane.requestId, status: 'sending' } })
    expect(await store.claim({ now, workerId: 'second' })).toBeNull()
    db.rows.set('educationSyncDispatchEvents/event-photo', { kind: 'action', taskKind: 'review-work', generation: 231, jobId: 'photo-job', eventId: 'event-photo' })
    db.rows.set('operatorSyncJobs/photo-job', { status: 'queued' })
    await store.markQueued({ requestId: lane.requestId, workerId: lane.workerId, now })
    expect(await store.claimRequest({ requestId: lane.requestId, tokenHash: 'token', now })).toMatchObject({ status: 'claimed', scope: 'action' })
    expect(await store.completeClaim({ requestId: lane.requestId, tokenHash: 'token', now })).toEqual({ status: 'incomplete_actions' })
    db.rows.get('operatorSyncJobs/photo-job').status = 'done'
    expect(await store.completeClaim({ requestId: lane.requestId, tokenHash: 'token', now })).toEqual({ status: 'completed', scope: 'action' })
    expect((await store.read()).status).toBe('blocked')
  })

  it('recovers a legacy blocked Mesh plus action backlog as one full request', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    const meshRequestId = '11111111-1111-4111-8111-111111111111'
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', generation: 177, requestId: meshRequestId,
      sendingGeneration: 165, sendingKinds: ['mesh'], pendingKinds: ['mesh', 'action'], sourceAttemptGeneration: 165,
      blockedReasonCode: 'source_unavailable', blockedAt: '2026-10-20T17:00:38.000Z',
      completedActionGeneration: 43, pendingActionAfterGeneration: 167, pendingActionThroughGeneration: 168,
      lastErrorCode: 'codex_exit_nonzero', queueReceiptId: 'stale-receipt', queuedAt: '2026-10-21T00:00:00.000Z',
      claimTokenHash: 'stale-claim', workflowLeaseUntil: '2026-10-21T06:00:00.000Z',
      actionLane: { requestId: 'old-action-request', status: 'blocked', blockedReasonCode: 'source_unavailable',
        generation: 167, sendingGeneration: 167, actionAfterGeneration: 43, actionThroughGeneration: 167,
        sourceAttemptGeneration: 167 } })
    for (let generation = 44; generation <= 168; generation += 1) {
      const jobId = `job-${generation}`
      db.rows.set(`educationSyncDispatchEvents/event-${generation}`, { kind: 'action', taskKind: 'triage-help',
        generation, jobId, eventId: String(generation) })
      db.rows.set(`operatorSyncJobs/${jobId}`, { status: generation <= 167 ? 'done' : 'queued' })
    }
    const claimed = await store.claim({ now: '2026-10-22T10:00:00.000Z', workerId: 'recovery-worker' })
    expect(claimed.requestId).not.toBe(meshRequestId)
    expect(claimed).toMatchObject({ generation: 177, workKinds: ['mesh', 'action'], actionAfterGeneration: 43, actionThroughGeneration: 168 })
    const active = db.rows.get('educationSyncDispatch/current')
    expect(active).toMatchObject({ status: 'sending', requestId: claimed.requestId, sendingGeneration: 177,
      sendingKinds: ['mesh', 'action'], sendingActionAfterGeneration: 43, sendingActionThroughGeneration: 168,
      sourceAttemptGeneration: 177, blockedReasonCode: null,
      lastErrorCode: null, queueReceiptId: null, queuedAt: null, claimTokenHash: null, workflowLeaseUntil: null,
      lastSourceBlock: { reasonCode: 'source_unavailable', attemptedGeneration: 167, retryGeneration: 177 },
      actionLane: { status: 'superseded', supersededByRequestId: claimed.requestId } })

    expect(await store.markQueued({ requestId: 'old-action-request', workerId: 'old-worker', now: '2026-10-22T10:00:00.000Z' }))
    expect(await store.claimRequest({ requestId: 'old-action-request', tokenHash: 'old-token', now: '2026-10-22T10:00:00.000Z' }))
      .not.toMatchObject({ status: 'claimed' })
    await store.markQueued({ requestId: claimed.requestId, workerId: claimed.workerId, now: '2026-10-22T10:00:00.000Z' })
    await store.claimRequest({ requestId: claimed.requestId, tokenHash: 'current-token', now: '2026-10-22T10:00:00.000Z' })
    await store.recordAction({ event: event(169), kind: 'triage-help', artifact: artifact(169),
      now: '2026-10-22T10:00:00.000Z', debounceUntil: '2026-10-22T10:00:20.000Z' })
    expect(db.rows.get('educationSyncDispatch/current')).toMatchObject({ generation: 178,
      sendingGeneration: 177, sendingActionThroughGeneration: 168,
      pendingActionAfterGeneration: 168, pendingActionThroughGeneration: 178 })
    const page = await store.readActionTasks({ requestId: claimed.requestId, limit: 100, now: '2026-10-22T10:00:00.000Z' })
    expect(page.tasks.slice(0, 2).map((task) => task.generation)).toEqual([44, 45])
    expect(page.tasks.at(-1).generation).toBe(143)
    const frozen = structuredClone(db.rows.get('educationSyncDispatch/current'))
    expect(await store.completeClaim({ requestId: claimed.requestId, tokenHash: 'stale-token', now: '2026-10-22T10:00:00.000Z' }))
      .toEqual({ status: 'invalid_claim' })
    expect(db.rows.get('educationSyncDispatch/current')).toEqual(frozen)
    expect(await store.completeClaim({ requestId: claimed.requestId, tokenHash: 'current-token', now: '2026-10-22T10:00:00.000Z' }))
      .toEqual({ status: 'incomplete_actions' })
    expect(db.rows.get('operatorSyncJobs/job-168')).toMatchObject({ status: 'queued' })
    expect(db.rows.get('educationSyncDispatch/current')).toEqual(frozen)
    db.rows.get('operatorSyncJobs/job-168').status = 'done'
    expect(await store.completeClaim({ requestId: claimed.requestId, tokenHash: 'current-token', now: '2026-10-22T10:00:00.000Z' }))
      .toEqual({ status: 'pending' })
    expect(db.rows.get('educationSyncDispatch/current')).toMatchObject({ status: 'pending',
      completedActionGeneration: 168, sourceRetryOf: meshRequestId, pendingKinds: ['action'],
      pendingActionAfterGeneration: 168, pendingActionThroughGeneration: 178 })
    const next = await store.claim({ now: '2026-10-22T10:00:20.000Z', workerId: 'next-worker' })
    expect(next).toMatchObject({ generation: 178, workKinds: ['action'], actionAfterGeneration: 168, actionThroughGeneration: 178 })
  })

  it('retries a blocked mixed full request only after a newer generation and keeps its issue annotation', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'prior-request', generation: 30,
      sendingGeneration: 20, sourceAttemptGeneration: 20, sendingKinds: ['mesh', 'action'], pendingKinds: ['mesh', 'action'],
      blockedReasonCode: 'source_unavailable', completedActionGeneration: 5,
      pendingActionAfterGeneration: 5, pendingActionThroughGeneration: 8, debounceUntil: now,
      lastSourceBlock: { requestId: 'prior-request', reasonCode: 'source_unavailable', attemptedGeneration: 20,
        generationAtBlock: 20, blockedAt: '2026-10-19T09:00:00.000Z' } })
    expect(await store.claim({ now, workerId: 'recovery' })).toMatchObject({ workKinds: ['mesh', 'action'], generation: 30 })
    const first = await store.read()
    const requestId = first.requestId
    await store.markQueued({ requestId, workerId: first.workerId, now })
    await store.claimRequest({ requestId, tokenHash: 'mixed-token', now })
    await store.blockClaim({ requestId, tokenHash: 'mixed-token', reasonCode: 'source_unavailable', now })
    const reblocked = await store.read()
    expect(reblocked).toMatchObject({ status: 'blocked', sendingKinds: ['mesh', 'action'], sourceAttemptGeneration: 30,
      lastSourceBlock: { reasonCode: 'source_unavailable', attemptedGeneration: 30 } })
    const lane = await store.claim({ now, workerId: 'independent' })
    expect(lane).toMatchObject({ workKinds: ['action'], actionAfterGeneration: 5, actionThroughGeneration: 8 })
    expect((await store.read()).status).toBe('blocked')

  })

  it('wakes a typed full-source block after an action-only batch receives a fresh Mesh generation', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'action-request', generation: 40,
      sendingGeneration: 40, sourceAttemptGeneration: 40, sendingKinds: ['action'], pendingKinds: [],
      blockedReasonCode: 'source_unavailable', completedActionGeneration: 5,
      pendingActionAfterGeneration: 5, pendingActionThroughGeneration: 8, debounceUntil: now })
    expect(await store.claim({ now, workerId: 'idle' })).toBeNull()
    const accepted = await store.recordMeshChange({ eventDigest: 'f'.repeat(64), now,
      debounceUntil: '2026-10-19T10:00:20.000Z' })
    expect(accepted.nextDueAt).toBe('2026-10-19T10:00:20.000Z')
    expect(await store.claim({ now: '2026-10-19T10:00:20.000Z', workerId: 'recovery' }))
      .toMatchObject({ generation: 41, workKinds: ['action', 'mesh'], actionAfterGeneration: 5, actionThroughGeneration: 8 })
  })

  it('wakes a typed action-only source block on a fresh action and ignores duplicate event delivery', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'action-request', generation: 40,
      sendingGeneration: 40, sourceAttemptGeneration: 40, sendingKinds: ['action'], pendingKinds: [],
      blockedReasonCode: 'source_unavailable', completedActionGeneration: 5,
      pendingActionAfterGeneration: 5, pendingActionThroughGeneration: null, debounceUntil: now })
    expect(await store.claim({ now, workerId: 'idle' })).toBeNull()
    const fresh = { ...event(19), eventType: 'help.requested' }
    const accepted = await store.recordAction({ event: fresh, kind: 'triage-help', artifact: artifact(19), now,
      debounceUntil: '2026-10-19T10:00:20.000Z' })
    expect(accepted).toMatchObject({ status: 'accepted', generation: 41, nextDueAt: '2026-10-19T10:00:20.000Z' })
    const duplicate = await store.recordAction({ event: fresh, kind: 'triage-help', artifact: artifact(19), now,
      debounceUntil: '2026-10-19T10:00:20.000Z' })
    expect(duplicate).toMatchObject({ status: 'duplicate' })
    expect(duplicate.nextDueAt).toBeUndefined()
    expect((await store.read()).generation).toBe(41)
    expect(await store.claim({ now: '2026-10-19T10:00:20.000Z', workerId: 'recovery' }))
      .toMatchObject({ generation: 41, workKinds: ['action'], actionAfterGeneration: 5, actionThroughGeneration: 41 })
  })

  it('continues an explicitly resumed persisted lane with its original request and frozen range', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'mesh-request', generation: 30,
      sendingGeneration: 20, sourceAttemptGeneration: 20, sendingKinds: ['mesh'], pendingKinds: ['mesh', 'work', 'action'],
      blockedReasonCode: 'source_unavailable', completedActionGeneration: 18,
      pendingActionAfterGeneration: 27, pendingActionThroughGeneration: 30,
      actionLane: { requestId: 'existing-action-request', status: 'pending', generation: 27, sendingGeneration: 27,
        actionAfterGeneration: 18, actionThroughGeneration: 19, retryAt: now } })
    const claimed = await store.claim({ now, workerId: 'resume-worker' })
    expect(claimed).toMatchObject({ requestId: 'existing-action-request', generation: 27, workKinds: ['action'],
      actionAfterGeneration: 18, actionThroughGeneration: 19 })
    expect(db.rows.get('educationSyncDispatch/current')).toMatchObject({ status: 'blocked', requestId: 'mesh-request',
      pendingActionAfterGeneration: 27, pendingActionThroughGeneration: 30,
      actionLane: { status: 'sending', requestId: 'existing-action-request', actionAfterGeneration: 18,
        actionThroughGeneration: 19 } })
  })

  it('moves an expired lane lease to uncertain and retries the same frozen range and request ID', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'mesh-request', generation: 30,
      sendingGeneration: 20, sourceAttemptGeneration: 20, sendingKinds: ['mesh'], pendingKinds: ['mesh'],
      blockedReasonCode: 'source_unavailable', completedActionGeneration: 18,
      actionLane: { requestId: 'existing-action-request', status: 'running', generation: 27, sendingGeneration: 27,
        actionAfterGeneration: 18, actionThroughGeneration: 19, workflowLeaseUntil: '2026-10-19T09:00:00.000Z',
        claimTokenHash: 'old-token' } })
    expect(await store.claim({ now, workerId: 'lease-check' })).toBeNull()
    expect(db.rows.get('educationSyncDispatch/current').actionLane).toMatchObject({ status: 'uncertain',
      lastErrorCode: 'workflow_lease_expired', actionAfterGeneration: 18, actionThroughGeneration: 19 })
    const retry = await store.claim({ now, workerId: 'retry-worker' })
    expect(retry).toMatchObject({ requestId: 'existing-action-request', generation: 27, workKinds: ['action'],
      actionAfterGeneration: 18, actionThroughGeneration: 19 })
    await store.markQueued({ requestId: retry.requestId, workerId: retry.workerId, now })
    await store.claimRequest({ requestId: retry.requestId, tokenHash: 'new-token', now })
    expect(await store.completeClaim({ requestId: retry.requestId, tokenHash: 'old-token', now }))
      .toEqual({ status: 'invalid_claim' })
  })

  it.each([
    ['missing exact action upper', { sendingKinds: ['action'], pendingKinds: ['action'], pendingActionAfterGeneration: 5,
      pendingActionThroughGeneration: null }],
    ['malformed attempt marker', { sourceAttemptGeneration: '40', sendingGeneration: 40 }],
    ['malformed pending upper', { pendingActionThroughGeneration: '8' }],
    ['missing action lower watermark', { completedActionGeneration: undefined }],
    ['non-array pending kinds', { pendingKinds: null }],
  ])('fails closed for source recovery with %s', async (_label, override) => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'blocked-request', generation: 41,
      sendingGeneration: 40, sourceAttemptGeneration: 40, sendingKinds: ['action'], pendingKinds: ['action'],
      blockedReasonCode: 'source_unavailable', completedActionGeneration: 5,
      pendingActionAfterGeneration: 5, pendingActionThroughGeneration: 8, debounceUntil: now, ...override })
    const before = structuredClone(db.rows.get('educationSyncDispatch/current'))
    expect(await store.claim({ now, workerId: 'worker' })).toBeNull()
    expect(db.rows.get('educationSyncDispatch/current')).toEqual(before)
  })

  it.each(['permission_required', 'manual_review_required'])('does not bypass a %s block', async (blockedReasonCode) => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', generation: 10, requestId: 'mesh-request',
      sendingGeneration: 3, sourceAttemptGeneration: 3, sendingKinds: ['mesh'], pendingKinds: ['action'], blockedReasonCode,
      completedActionGeneration: 5, pendingActionAfterGeneration: 5, pendingActionThroughGeneration: 10 })
    expect(await store.claim({ now, workerId: 'worker' })).toBeNull()
    expect(db.rows.get('educationSyncDispatch/current')).toMatchObject({ status: 'blocked', blockedReasonCode })
  })

  it('does not recover an ambiguous source block without an attempted-generation watermark', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', generation: 10, requestId: 'legacy',
      sendingKinds: ['mesh'], pendingKinds: ['mesh'], blockedReasonCode: 'source_unavailable' })
    expect(await store.claim({ now, workerId: 'worker' })).toBeNull()
  })

  it('keeps new action generations outside a running Mesh claim with no frozen action upper bound', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'running', requestId: 'mesh-request', claimTokenHash: 'mesh-token',
      workflowLeaseUntil: '2026-10-19T16:00:00.000Z', generation: 1, sendingGeneration: 1, sendingKinds: ['mesh'],
      sendingActionAfterGeneration: 0, sendingActionThroughGeneration: null, completedActionGeneration: 0,
      pendingKinds: [], pendingActionAfterGeneration: 0, pendingActionThroughGeneration: null })
    await store.recordAction({ event: event(19), kind: 'triage-help', artifact: artifact(19), now, debounceUntil: now })

    await expect(store.readActionTasks({ requestId: 'mesh-request', limit: 100, now })).rejects.toThrow('education_sync_action_request_unclaimed')
    expect(await store.completeClaim({ requestId: 'mesh-request', tokenHash: 'mesh-token', now })).toEqual({ status: 'pending' })
    expect(db.rows.get('educationSyncDispatch/current')).toMatchObject({ status: 'pending', requestId: null,
      completedActionGeneration: 0, pendingActionAfterGeneration: 0, pendingActionThroughGeneration: 2,
      pendingKinds: ['action'], sendingActionThroughGeneration: null })
  })

  it('waits through source debounce, then retries one combined request after another source block', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    const blocked = { status: 'blocked', requestId: 'old-mesh-request', generation: 10, sendingGeneration: 3,
      sourceAttemptGeneration: 3, sendingKinds: ['mesh'], pendingKinds: ['mesh', 'action'],
      blockedReasonCode: 'source_unavailable', completedActionGeneration: 5,
      pendingActionAfterGeneration: 5, pendingActionThroughGeneration: 8,
      debounceUntil: '2026-10-19T10:00:20.000Z' }
    db.rows.set('educationSyncDispatch/current', blocked)
    expect(await store.claim({ now: '2026-10-19T10:00:19.999Z', workerId: 'early-worker' })).toBeNull()
    db.rows.set('educationSyncDispatch/current', { ...blocked, debounceUntil: '2026-10-19T10:00:20.000Z' })
    const first = await store.claim({ now: '2026-10-19T10:00:20.000Z', workerId: 'due-worker' })
    expect(first).toMatchObject({ actionAfterGeneration: 5, actionThroughGeneration: 8, workKinds: ['mesh', 'action'] })
    await store.markQueued({ requestId: first.requestId, workerId: first.workerId, now })
    await store.claimRequest({ requestId: first.requestId, tokenHash: 'source-token', now })
    expect(await store.blockClaim({ requestId: first.requestId, tokenHash: 'source-token', reasonCode: 'source_unavailable', now }))
      .toMatchObject({ status: 'blocked' })
    const lane = await store.claim({ now, workerId: 'independent' })
    expect(lane).toMatchObject({ workKinds: ['action'], actionAfterGeneration: 5, actionThroughGeneration: 8 })
    expect((await store.read()).status).toBe('blocked')

  })

  it('deduplicates identical event IDs and freezes a request-scoped action range', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    await store.recordAction({ event: event(1), kind: 'triage-help', artifact: artifact(1), now, debounceUntil: now })
    expect(await store.recordAction({ event: event(1), kind: 'triage-help', artifact: artifact(1), now, debounceUntil: now }))
      .toMatchObject({ status: 'duplicate' })
    await store.recordAction({ event: event(2, 'quiz.submitted'), kind: 'review-quiz', artifact: artifact(2), now, debounceUntil: now })
    const claimed = await store.claim({ now, workerId: 'dispatcher-1' })
    expect(claimed).toMatchObject({ actionAfterGeneration: 0, actionThroughGeneration: 2, workKinds: ['action'] })
    await store.markQueued({ requestId: claimed.requestId, workerId: claimed.workerId, now })
    await store.claimRequest({ requestId: claimed.requestId, tokenHash: 'claim-hash', now })
    const firstPage = await store.readActionTasks({ requestId: claimed.requestId, limit: 1, now })
    expect(firstPage).toMatchObject({ complete: true, tasks: [{ generation: 1, eventId: event(1).eventId, kind: 'triage-help' }] })
    const secondPage = await store.readActionTasks({ requestId: claimed.requestId, cursor: firstPage.nextCursor, limit: 1, now })
    expect(secondPage).toMatchObject({ complete: true, nextCursor: null, tasks: [{ generation: 2, eventId: event(2).eventId, kind: 'review-quiz' }] })
    expect(await store.completeClaim({ requestId: claimed.requestId, tokenHash: 'claim-hash', now })).toEqual({ status: 'incomplete_actions' })
    for (const task of [...firstPage.tasks, ...secondPage.tasks]) db.rows.get(`operatorSyncJobs/${task.jobId}`).status = 'done'
    expect(await store.completeClaim({ requestId: claimed.requestId, tokenHash: 'claim-hash', now })).toEqual({ status: 'completed' })
    await expect(store.readActionTasks({ requestId: 'other-request', limit: 1, now })).rejects.toThrow('education_sync_action_request_unclaimed')
  })

  it('does not widen an already frozen batch with events arriving during the run', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    await store.recordAction({ event: event(3), kind: 'triage-help', artifact: artifact(3), now, debounceUntil: now })
    const claimed = await store.claim({ now, workerId: 'dispatcher-1' })
    await store.markQueued({ requestId: claimed.requestId, workerId: claimed.workerId, now })
    await store.claimRequest({ requestId: claimed.requestId, tokenHash: 'claim-hash', now })
    await store.recordAction({ event: event(4), kind: 'triage-help', artifact: artifact(4), now, debounceUntil: now })
    const tasks = await store.readActionTasks({ requestId: claimed.requestId, limit: 10, now })
    expect(tasks.tasks.map((task) => task.eventId)).toEqual([event(3).eventId])
  })
})
