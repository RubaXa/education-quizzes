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
  it('executes a frozen action lane beside a blocked Mesh request and leaves Mesh blocked', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    const meshRequestId = 'cfadc7a5-ff0f-4ad5-b744-58deebb9fb39'
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', generation: 18, requestId: meshRequestId,
      sendingGeneration: 19, sendingKinds: ['mesh'], pendingKinds: ['mesh', 'action'],
      blockedReasonCode: 'source_unavailable', blockedAt: '2026-10-20T17:00:38.000Z',
      completedActionGeneration: 18, pendingActionAfterGeneration: 18, pendingActionThroughGeneration: null })
    for (let id = 19; id <= 43; id += 1) await store.recordAction({ event: event(id), kind: 'triage-help', artifact: artifact(id), now, debounceUntil: now })
    Object.assign(db.rows.get('educationSyncDispatch/current'), { generation: 162 })

    const claimed = await store.claim({ now, workerId: 'action-worker-1' })
    expect(claimed.requestId).not.toBe(meshRequestId)
    expect(claimed).toMatchObject({ generation: 162,
      workKinds: ['action'], actionAfterGeneration: 18, actionThroughGeneration: 43 })
    expect(db.rows.get('educationSyncDispatch/current')).toMatchObject({ status: 'blocked', requestId: meshRequestId,
      sendingGeneration: 19, sendingKinds: ['mesh'], blockedReasonCode: 'source_unavailable',
      actionLane: { status: 'sending', requestId: claimed.requestId, actionAfterGeneration: 18, actionThroughGeneration: 43 } })
    expect(await store.resumeBlocked({ requestId: meshRequestId, now })).toEqual({ status: 'action_busy' })
    await store.recordAction({ event: event(44), kind: 'triage-help', artifact: artifact(44), now, debounceUntil: now })
    expect(db.rows.get('educationSyncDispatch/current')).toMatchObject({ pendingActionAfterGeneration: 43, pendingActionThroughGeneration: 163 })

    await store.markQueued({ requestId: claimed.requestId, workerId: claimed.workerId, now })
    await store.claimRequest({ requestId: claimed.requestId, tokenHash: 'old-claim', now })
    const staleTime = new Date(Date.parse(now) + 6 * 60 * 60_000 + 1).toISOString()
    expect(await store.claim({ now: staleTime, workerId: 'action-worker-2' })).toBeNull()
    expect(await store.heartbeatClaim({ requestId: claimed.requestId, tokenHash: 'old-claim', now: staleTime }))
      .toEqual({ status: 'invalid_claim' })
    const leaseRetry = await store.claim({ now: new Date(Date.parse(staleTime) + 1).toISOString(), workerId: 'action-worker-2' })
    expect(leaseRetry).toMatchObject({ requestId: claimed.requestId, actionAfterGeneration: 18, actionThroughGeneration: 43 })
    await store.markUncertain({ requestId: leaseRetry.requestId, workerId: leaseRetry.workerId, now: staleTime, code: 'codex_timeout' })
    expect(await store.claim({ now: new Date(Date.parse(staleTime) + 59_999).toISOString(), workerId: 'action-worker-3' })).toBeNull()
    const retry = await store.claim({ now: new Date(Date.parse(staleTime) + 60_000).toISOString(), workerId: 'action-worker-3' })
    expect(retry).toMatchObject({ requestId: claimed.requestId, actionAfterGeneration: 18, actionThroughGeneration: 43 })
    await store.markQueued({ requestId: retry.requestId, workerId: retry.workerId, now: staleTime })
    await store.claimRequest({ requestId: retry.requestId, tokenHash: 'current-claim', now: staleTime })
    const stateBeforeStaleComplete = structuredClone(db.rows.get('educationSyncDispatch/current'))
    expect(await store.completeClaim({ requestId: retry.requestId, tokenHash: 'old-claim', now: staleTime })).toEqual({ status: 'invalid_claim' })
    expect(db.rows.get('educationSyncDispatch/current')).toEqual(stateBeforeStaleComplete)
    const page = await store.readActionTasks({ requestId: retry.requestId, limit: 100, now: staleTime })
    expect(page.tasks).toHaveLength(25)
    expect(await store.completeClaim({ requestId: retry.requestId, tokenHash: 'current-claim', now: staleTime }))
      .toEqual({ status: 'incomplete_actions' })

    for (const task of page.tasks) db.rows.get(`operatorSyncJobs/${task.jobId}`).status = 'done'
    expect(await store.completeClaim({ requestId: retry.requestId, tokenHash: 'current-claim', now: staleTime }))
      .toEqual({ status: 'completed', scope: 'action' })
    await store.markQueued({ requestId: retry.requestId, workerId: retry.workerId, now: staleTime })
    expect(db.rows.get('educationSyncDispatch/current')).toMatchObject({ status: 'blocked', requestId: meshRequestId,
      generation: 163, sendingGeneration: 19, sendingKinds: ['mesh'], blockedReasonCode: 'source_unavailable',
      completedActionGeneration: 43, pendingActionAfterGeneration: 43, pendingActionThroughGeneration: 163,
      actionAfterGeneration: 43, actionThroughGeneration: 163,
      actionLane: { status: 'completed', actionThroughGeneration: 43 } })

    const next = await store.claim({ now: staleTime, workerId: 'action-worker-4' })
    expect(next).toMatchObject({ generation: 163, workKinds: ['action'], actionAfterGeneration: 43, actionThroughGeneration: 163 })
    expect(next.requestId).not.toBe(retry.requestId)
    await store.markQueued({ requestId: next.requestId, workerId: next.workerId, now: staleTime })
    await store.claimRequest({ requestId: next.requestId, tokenHash: 'last-claim', now: staleTime })
    const nextPage = await store.readActionTasks({ requestId: next.requestId, limit: 100, now: staleTime })
    expect(nextPage.tasks.map((task) => task.generation)).toEqual([163])
    db.rows.get(`operatorSyncJobs/${nextPage.tasks[0].jobId}`).status = 'done'
    expect(await store.completeClaim({ requestId: next.requestId, tokenHash: 'last-claim', now: staleTime }))
      .toEqual({ status: 'completed', scope: 'action' })
    expect(db.rows.get('educationSyncDispatch/current')).toMatchObject({ status: 'blocked', requestId: meshRequestId,
      pendingActionAfterGeneration: null, pendingActionThroughGeneration: null, actionAfterGeneration: null,
      actionThroughGeneration: null, pendingKinds: ['mesh'], completedActionGeneration: 163 })
    expect(await store.resumeBlocked({ requestId: meshRequestId, now: staleTime })).toEqual({ status: 'pending', requestId: meshRequestId })
    expect(db.rows.get('educationSyncDispatch/current')).toMatchObject({ status: 'pending', sendingGeneration: 163,
      pendingKinds: [], blockedReasonCode: null, resumeTrigger: 'operator_resume_mesh_coalesced' })
  })

  it.each([
    ['permission_required', ['mesh']], ['manual_review_required', ['mesh']], ['source_unavailable', ['mesh', 'work']],
  ])('does not bypass a %s or mixed source blocker for action work', async (blockedReasonCode, sendingKinds) => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', generation: 10, requestId: 'mesh-request',
      sendingGeneration: 3, sendingKinds, pendingKinds: ['action'], blockedReasonCode,
      completedActionGeneration: 5, pendingActionAfterGeneration: 5, pendingActionThroughGeneration: 10 })
    expect(await store.claim({ now, workerId: 'worker' })).toBeNull()
    expect(db.rows.get('educationSyncDispatch/current').actionLane).toBeUndefined()
  })

  it('continues an existing frozen lane even if parent pending metadata later broadens', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'mesh-request', generation: 10,
      sendingGeneration: 3, sendingKinds: ['mesh'], sendingActionThroughGeneration: 18,
      pendingKinds: ['mesh', 'work', 'action'], blockedReasonCode: 'source_unavailable',
      pendingActionAfterGeneration: 18, pendingActionThroughGeneration: 20,
      actionLane: { requestId: 'existing-action-request', status: 'pending', generation: 10, sendingGeneration: 10,
        actionAfterGeneration: 18, actionThroughGeneration: 19 } })
    expect(await store.claim({ now, workerId: 'retry-worker' })).toMatchObject({ requestId: 'existing-action-request',
      workKinds: ['action'], actionAfterGeneration: 18, actionThroughGeneration: 19 })
  })

  it.each([
    ['frozen positive action upper', { sendingActionThroughGeneration: 18, pendingKinds: ['mesh', 'action'] }],
    ['malformed nonzero action upper', { sendingActionThroughGeneration: '18', pendingKinds: ['mesh', 'action'] }],
    ['unrelated pending source kind', { sendingActionThroughGeneration: null, pendingKinds: ['mesh', 'work', 'action'] }],
  ])('does not create an action lane for a blocked Mesh request with %s', async (_label, extra) => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'mesh-request', generation: 10,
      sendingGeneration: 3, sendingKinds: ['mesh'], blockedReasonCode: 'source_unavailable',
      completedActionGeneration: 5, pendingActionAfterGeneration: 5, pendingActionThroughGeneration: 10, ...extra })
    expect(await store.claim({ now, workerId: 'worker' })).toBeNull()
    expect(db.rows.get('educationSyncDispatch/current').actionLane).toBeUndefined()
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

  it('keeps a resumed blocked action lane frozen across retry and preserves the parent Mesh block', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'mesh-request', generation: 10,
      sendingGeneration: 3, sendingKinds: ['mesh'], pendingKinds: ['mesh'], blockedReasonCode: 'source_unavailable',
      completedActionGeneration: 5, pendingActionAfterGeneration: 5, pendingActionThroughGeneration: null })
    for (let generation = 6; generation <= 8; generation += 1) {
      await store.recordAction({ event: event(generation), kind: 'triage-help', artifact: artifact(generation), now, debounceUntil: now })
    }
    const lane = await store.claim({ now, workerId: 'action-worker' })
    await store.markQueued({ requestId: lane.requestId, workerId: lane.workerId, now })
    await store.claimRequest({ requestId: lane.requestId, tokenHash: 'action-token', now })
    expect(await store.blockClaim({ requestId: lane.requestId, tokenHash: 'action-token', reasonCode: 'source_unavailable', now }))
      .toMatchObject({ status: 'blocked', scope: 'action' })
    expect(await store.resumeBlocked({ requestId: lane.requestId, now })).toMatchObject({ status: 'pending', scope: 'action' })
    const retry = await store.claim({ now, workerId: 'action-worker-retry' })
    expect(retry).toMatchObject({ requestId: lane.requestId, actionAfterGeneration: 5, actionThroughGeneration: 13 })
    await store.markQueued({ requestId: retry.requestId, workerId: retry.workerId, now })
    await store.claimRequest({ requestId: retry.requestId, tokenHash: 'retry-token', now })
    expect(await store.failClaim({ requestId: retry.requestId, tokenHash: 'retry-token', now, retryAt: '2026-10-19T10:01:00.000Z' }))
      .toMatchObject({ status: 'pending', scope: 'action' })
    expect(db.rows.get('educationSyncDispatch/current')).toMatchObject({ status: 'blocked', requestId: 'mesh-request',
      blockedReasonCode: 'source_unavailable', actionLane: { status: 'pending', requestId: lane.requestId,
        actionAfterGeneration: 5, actionThroughGeneration: 13 } })
  })

  it('does not auto-resume a blocked Mesh parent when a new Mesh event arrives during an action lane', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'mesh-request', generation: 10,
      sendingGeneration: 3, sendingKinds: ['mesh'], pendingKinds: ['mesh'], blockedReasonCode: 'source_unavailable',
      completedActionGeneration: 5, pendingActionAfterGeneration: 5, pendingActionThroughGeneration: null })
    await store.recordAction({ event: event(6), kind: 'triage-help', artifact: artifact(6), now, debounceUntil: now })
    const lane = await store.claim({ now, workerId: 'action-worker' })
    await store.recordMeshChange({ eventDigest: 'c'.repeat(64), now, debounceUntil: now })
    expect(await store.read()).toMatchObject({ status: 'blocked', requestId: 'mesh-request',
      blockedReasonCode: 'source_unavailable', actionLane: { requestId: lane.requestId, status: 'sending' } })
  })

  it('honors the action debounce before a new lane and restores a due persisted range without a new event', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    db.rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'mesh-request', generation: 10,
      sendingGeneration: 3, sendingKinds: ['mesh'], pendingKinds: ['mesh', 'action'], blockedReasonCode: 'source_unavailable',
      completedActionGeneration: 5, pendingActionAfterGeneration: 5, pendingActionThroughGeneration: 8,
      debounceUntil: '2026-10-19T10:00:20.000Z' })
    expect(await store.claim({ now: '2026-10-19T10:00:19.999Z', workerId: 'early-worker' })).toBeNull()
    expect(await store.claim({ now: '2026-10-19T10:00:20.000Z', workerId: 'due-worker' }))
      .toMatchObject({ actionAfterGeneration: 5, actionThroughGeneration: 8, workKinds: ['action'] })
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
