import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { enqueueExistingEvent, listEvents, main } from './education-sync-dispatch.mjs'
import { observeDispatchProgress } from '../sync/dispatch-workspace.mjs'

const REQUEST = '01a150dc-e067-7cc2-b08f-f573bf83e6e3'

function output() { let value = ''; return { write: (part) => { value += part }, value: () => value } }

describe('education sync dispatch CLI', () => {
  it('reuses only this chat’s server-verified claim after a lost claimed response', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'education-own-claim-'))
    const store = { claimRequest: vi.fn(async ({tokenHash}) => { store.hash=tokenHash; return {status:'claimed'} }),
      read: async()=>({status:'running',requestId:REQUEST,claimTokenHash:store.hash,workflowLeaseUntil:'2999-01-01T00:00:00Z'}),
      heartbeatClaim: vi.fn(async()=>({status:'running'})) }
    const deps = {env:{TELEGRAM_FIRESTORE_PROJECT_ID:'petr-education',EDUCATION_SYNC_PROJECT_ROOT:root,CODEX_THREAD_ID:REQUEST},out:output(),err:output(),createDb:()=>({terminate:async()=>{}}),createStore:()=>store}
    try {
      await main(['claim','--request',REQUEST],deps)
      const first=JSON.parse(deps.out.value()), original=readFileSync(first.claimPath,'utf8'), next=output()
      await main(['claim','--request',REQUEST],{...deps,out:next})
      expect(JSON.parse(next.value())).toMatchObject({status:'claimed',reused:true,claimPath:first.claimPath})
      expect(store.claimRequest).toHaveBeenCalledTimes(1)
      expect(store.heartbeatClaim).toHaveBeenCalledOnce()
      expect(readFileSync(first.claimPath,'utf8')).toBe(original)
      store.claimRequest.mockResolvedValue({status:'running'})
      store.hash='another-token'
      const stale=output()
      await main(['claim','--request',REQUEST],{...deps,out:stale})
      expect(JSON.parse(stale.value())).toEqual({status:'running'})
      expect(readFileSync(first.claimPath,'utf8')).toBe(original)
      expect(store.heartbeatClaim).toHaveBeenCalledOnce()
      store.claimRequest.mockResolvedValue({status:'running'})
      const other=output()
      await main(['claim','--request',REQUEST],{...deps,env:{...deps.env,CODEX_THREAD_ID:'another-chat'},out:other})
      expect(JSON.parse(other.value())).toEqual({status:'running'})
      expect(readFileSync(first.claimPath,'utf8')).toBe(original)
    } finally {rmSync(root,{recursive:true,force:true})}
  })
  it('ticks the worker observation without pretending the agent reacted and flags five minutes of silence',()=>{
    const root=mkdtempSync(resolve(tmpdir(),'education-health-'))
    const state={status:'running',requestId:REQUEST,claimedAt:'2026-11-19T15:00:00Z',heartbeatAt:'2026-11-19T15:01:00Z'}
    try {
      expect(observeDispatchProgress(root,state,{now:'2026-11-19T15:05:59Z',pid:123})).toMatchObject({state:'active',lastReactionAt:state.heartbeatAt,workerPid:123})
      const stalled=observeDispatchProgress(root,state,{now:'2026-11-19T15:06:00Z',pid:123})
      expect(stalled).toMatchObject({state:'stalled',silentForMs:300000,lastReactionAt:state.heartbeatAt})
      expect(observeDispatchProgress(root,state,{now:'2026-11-19T15:07:00Z',pid:123})).toMatchObject({state:'stalled',lastReactionAt:state.heartbeatAt})
      const path=resolve(root,'.local/education-sync-dispatch/work',REQUEST,'health.json')
      expect(statSync(path).mode&0o077).toBe(0)
      expect(readFileSync(path,'utf8')).not.toContain('token')
      expect(observeDispatchProgress(root,{...state,status:'completed'},{now:'2026-11-19T15:08:00Z'})).toMatchObject({state:'closed'})
    } finally {rmSync(root,{recursive:true,force:true})}
  })
  it('resumes here atomically and writes a private claim without queueing a chat message', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'education-resume-here-')), out = output()
    const store = { resumeBlocked: vi.fn(async () => ({ status: 'claimed' })) }
    try {
      expect(await main(['resume-here', '--request', REQUEST], { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education', EDUCATION_SYNC_PROJECT_ROOT: root },
        out, err: output(), createDb: () => ({ terminate: async () => {} }), createStore: () => store })).toBe(0)
      const result = JSON.parse(out.value())
      expect(result.status).toBe('claimed')
      expect(statSync(result.claimPath).mode & 0o077).toBe(0)
      expect(store.resumeBlocked).toHaveBeenCalledWith(expect.objectContaining({ requestId: REQUEST, tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) }))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('continues locally, cleans only acknowledged batch files, and releases the claim only when empty', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'education-drainer-'))
    const out = output(), err = output()
    const store = { claimRequest: vi.fn(async () => ({ status: 'claimed' })),
      completeClaim: vi.fn().mockResolvedValueOnce({ status: 'continued', generation: 2, needsFullVerification: false })
        .mockResolvedValueOnce({ status: 'completed' }) }
    const deps = { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education', EDUCATION_SYNC_PROJECT_ROOT: root },
      out, err, createDb: () => ({ terminate: async () => {} }), createStore: () => store }
    try {
      await main(['claim', '--request', REQUEST], deps)
      const claimPath = JSON.parse(out.value()).claimPath
      const base = resolve(root, '.local/education-sync-dispatch/tasks', REQUEST)
      for (const generation of [1, 2]) { mkdirSync(resolve(base, `batch-${generation}`), { recursive: true }); writeFileSync(resolve(base, `batch-${generation}`, 'page-1.json'), 'private') }
      const next = generation => main(['next', '--request', REQUEST, '--claim-file', claimPath, '--generation', String(generation)], { ...deps, out: output() })
      expect(await next(1)).toBe(0)
      expect(existsSync(claimPath)).toBe(true)
      expect(existsSync(resolve(base, 'batch-1'))).toBe(false)
      expect(existsSync(resolve(base, 'batch-2'))).toBe(true)
      const progress = resolve(root, '.local/education-sync-dispatch/work', REQUEST, 'progress.json')
      expect(JSON.parse(readFileSync(progress, 'utf8'))).toMatchObject({ phase: 'claimed', generation: 2, completedGeneration: 1 })
      expect(statSync(progress).mode & 0o077).toBe(0)
      expect(await next(2)).toBe(0)
      expect(existsSync(claimPath)).toBe(false)
      expect(existsSync(resolve(base, 'batch-2'))).toBe(false)
      expect(readFileSync(progress, 'utf8')).not.toContain('token')
      expect(store.completeClaim).toHaveBeenCalledWith(expect.objectContaining({ drain: true, expectedGeneration: 1 }))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('reports action backlog and its independent lane without leaking private claim fields', async () => {
    const out = output()
    const state = { status: 'blocked', generation: 162, sendingGeneration: 19, pendingKinds: ['mesh', 'action', 'action', 'unknown'],
      sendingKinds: ['mesh'], blockedReasonCode: 'source_unavailable', completedActionGeneration: 18,
      pendingActionAfterGeneration: 18, pendingActionThroughGeneration: 43, claimTokenHash: 'PRIVATE_HASH',
      sourceAttemptGeneration: 19, lastSourceBlock: { requestId: REQUEST, reasonCode: 'source_unavailable',
        attemptedGeneration: 19, generationAtBlock: 19, blockedAt: '2026-10-20T17:00:38.000Z', secret: 'PRIVATE_SECRET' },
      actionLane: { status: 'running', requestId: REQUEST, actionAfterGeneration: 18, actionThroughGeneration: 43,
        claimTokenHash: 'PRIVATE_LANE_HASH', sourcePayload: 'PRIVATE_PAYLOAD' } }
    expect(await main(['status'], { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education' }, out, err: output(),
      createDb: () => ({ terminate: async () => {} }), createStore: () => ({ read: async () => state }) })).toBe(0)
    expect(JSON.parse(out.value())).toMatchObject({ status: 'blocked', pendingKinds: ['mesh', 'action'],
      completedActionGeneration: 18, pendingActionThroughGeneration: 43,
      sourceAttemptGeneration: 19, lastSourceBlock: { reasonCode: 'source_unavailable', attemptedGeneration: 19,
        generationAtBlock: 19, blockedAt: '2026-10-20T17:00:38.000Z' },
      actionLane: { status: 'running', requestId: REQUEST, actionAfterGeneration: 18, actionThroughGeneration: 43 } })
    expect(out.value()).not.toContain('PRIVATE')
    expect(out.value()).not.toContain('unknown')
  })

  it('returns a nonzero exit code when an active action lane prevents resuming Mesh', async () => {
    const out = output()
    const code = await main(['resume', '--request', REQUEST], { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education' },
      out, err: output(), createDb: () => ({ terminate: async () => {} }),
      createStore: () => ({ resumeBlocked: async () => ({ status: 'action_busy' }) }) })
    expect(code).toBe(1)
    expect(JSON.parse(out.value())).toEqual({ status: 'action_busy' })
  })

  it('claims into a private file and completes only with its matching token', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'education-sync-claim-'))
    let out = output()
    const err = output()
    const store = {
      claimRequest: vi.fn(async ({ tokenHash }) => { store.tokenHash = tokenHash; return { status: 'claimed' } }),
      completeClaim: vi.fn(async ({ tokenHash }) => ({ status: tokenHash === store.tokenHash ? 'completed' : 'invalid_claim' })),
      failClaim: vi.fn(), heartbeatClaim: vi.fn(), read: vi.fn(),
    }
    const createDb = vi.fn(() => ({ terminate: vi.fn(async () => {}) }))
    const deps = { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education', EDUCATION_SYNC_PROJECT_ROOT: root }, cwd: root,
      out, err, createDb, createStore: () => store }
    try {
      expect(await main(['claim', '--request', REQUEST], deps)).toBe(0)
      const claimPath = JSON.parse(out.value()).claimPath
      expect(claimPath).toBe(resolve(root, '.local/education-sync-dispatch/claims', `${REQUEST}.json`))
      expect(statSync(claimPath).mode & 0o077).toBe(0)
      const claim = JSON.parse(readFileSync(claimPath, 'utf8'))
      expect(claim.token).toBeTruthy()
      out = output()
      expect(await main(['complete', '--request', REQUEST, '--claim-file', claimPath], { ...deps, out })).toBe(0)
      const terminal = JSON.parse(out.value())
      expect(terminal.runReport).toMatchObject({ lifecycle: 'finished', sourceCycleComplete: false, outcome: 'partial' })
      expect(JSON.parse(readFileSync(resolve(root, '.local/education-sync-dispatch/work', REQUEST, 'progress.json'), 'utf8')).phase).toBe('completed')
      expect(store.completeClaim).toHaveBeenCalledWith(expect.objectContaining({ requestId: REQUEST, tokenHash: store.tokenHash }))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('terminates Firestore on invalid commands and does not echo unsafe errors', async () => {
    const db = { terminate: vi.fn(async () => {}) }
    const out = output(), err = output()
    const code = await main(['complete', '--request', 'bad'], { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education' },
      createDb: () => db, createStore: () => ({}), out, err })
    expect(code).toBe(1)
    expect(db.terminate).toHaveBeenCalledOnce()
    expect(err.value()).toBe('usage_invalid\n')
  })

  it('uses the script checkout root when invoked from a parent working directory', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'education-sync-root-'))
    const out = output()
    const db = { terminate: vi.fn(async () => {}) }
    try {
      await main(['status'], { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education' },
        cwd: '/Users/example/Documents/ChatGPT/PETR', scriptRoot: root,
        createDb: (options) => { expect(options.cwd).toBe(root); return db },
        createStore: () => ({ read: async () => null }), out, err: output() })
      expect(out.value()).toContain('"status":"idle"')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('supports an explicit permission block and operator resume without a new request id', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'education-sync-block-'))
    const out = output(), err = output()
    const store = {
      claimRequest: vi.fn(async () => ({ status: 'claimed' })),
      blockClaim: vi.fn(async ({ requestId, reasonCode }) => ({ status: 'blocked', requestId, reasonCode })),
      resumeBlocked: vi.fn(async ({ requestId }) => ({ status: 'pending', requestId })),
      read: vi.fn(),
    }
    const deps = { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education', EDUCATION_SYNC_PROJECT_ROOT: root },
      out, err, createDb: () => ({ terminate: vi.fn(async () => {}) }), createStore: () => store }
    try {
      await main(['claim', '--request', REQUEST], deps)
      const claimPath = JSON.parse(out.value()).claimPath
      await main(['block', '--request', REQUEST, '--claim-file', claimPath, '--reason', 'permission_required', '--operation', 'data-publication', '--denial-ref', 'tool-policy:call_denied_123'], deps)
      expect(store.blockClaim).toHaveBeenCalledWith(expect.objectContaining({ requestId: REQUEST, reasonCode: 'permission_required', permissionBlock: { operation: 'data-publication', denialRef: 'tool-policy:call_denied_123' } }))
      expect(JSON.parse(readFileSync(resolve(root, '.local/education-sync-dispatch/work', REQUEST, 'progress.json'), 'utf8')).phase).toBe('blocked')
      out.value = () => ''
      expect(await main(['resume', '--request', REQUEST], deps)).toBe(0)
      expect(store.resumeBlocked).toHaveBeenCalledWith(expect.objectContaining({ requestId: REQUEST }))
      expect(err.value()).toBe('')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('recovers an accepted Firestore work event for a registered owner without requiring Mesh access', async () => {
    const event = { eventId: 'a'.repeat(64), source: 'firestore', eventType: 'upload.confirmed', familyId: 'family-a', childId: 'child-a',
      scopeKey: 'b'.repeat(64), sourceEventKey: 'c'.repeat(64) }
    const store = { recordSourceChange: vi.fn(async () => ({ status: 'accepted' })) }
    const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => event }) }) }) }
    const createInventory = vi.fn(() => ({ enumerate: async () => ({ complete: true, families: [{ familyId: 'family-a' }],
      registeredChildren: [{ familyId: 'family-a', childId: 'child-a', hasMeshAccount: false }] }) }))
    await expect(enqueueExistingEvent(db, store, event.eventId, { createInventory })).resolves.toEqual({ status: 'accepted' })
    expect(store.recordSourceChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'work', eventDigest: expect.any(String) }))
  })

  it('rejects recovery when the event owner is no longer registered', async () => {
    const event = { eventId: 'a'.repeat(64), source: 'firestore', eventType: 'quiz.submitted', familyId: 'family-a', childId: 'child-a',
      scopeKey: 'b'.repeat(64), sourceEventKey: 'c'.repeat(64) }
    const store = { recordSourceChange: vi.fn() }
    const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => event }) }) }) }
    await expect(enqueueExistingEvent(db, store, event.eventId, { createInventory: () => ({ enumerate: async () => ({ complete: true,
      families: [{ familyId: 'family-a' }], registeredChildren: [] }) }) })).rejects.toThrow('event_owner_unverified')
    expect(store.recordSourceChange).not.toHaveBeenCalled()
  })

  it('lists only selected recent IDs for current owners and reports bounded truncation', async () => {
    const selected = []
    const docs = Array.from({ length: 101 }, (_, index) => ({ data: () => ({ eventId: index.toString(16).padStart(64, '0'),
      source: 'firestore', eventType: 'upload.confirmed', detectedAt: '2026-10-19T20:21:00.000Z', familyId: 'family-a', childId: 'child-a' }) }))
    const query = { where: (...args) => { selected.push(['where', ...args]); return query }, orderBy: (...args) => { selected.push(['orderBy', ...args]); return query },
      limit: (...args) => { selected.push(['limit', ...args]); return query }, select: (...args) => { selected.push(['select', ...args]); return query },
      get: async () => ({ docs }) }
    const db = { collection: () => query }
    const result = await listEvents(db, '2026-10-19T20:20:00.000Z', { createInventory: () => ({ enumerate: async () => ({ complete: true,
      families: [{ familyId: 'family-a' }], registeredChildren: [{ familyId: 'family-a', childId: 'child-a', hasMeshAccount: false }] }) }) })
    expect(result).toMatchObject({ truncated: true, scanned: 101 })
    expect(result.events).toHaveLength(100)
    expect(result.events[0]).not.toHaveProperty('familyId')
    expect(selected).toContainEqual(['where', 'detectedAt', '>=', '2026-10-19T20:20:00.000Z'])
    expect(selected).toContainEqual(['limit', 101])
    expect(selected.at(-1)).toEqual(['select', 'eventId', 'source', 'eventType', 'occurredAt', 'detectedAt', 'familyId', 'childId'])
  })

  it.each([
    ['firestore', 'upload.confirmed', '2026-10-19T20:20:00.000Z', 61_000],
    ['firestore', 'quiz.submitted', '2026-10-19T20:20:00.000Z', 61_000],
    ['mesh', 'grade.created', '2026-10-19T20:20:00.000Z', undefined],
    ['firestore', 'upload.confirmed', 'invalid', undefined],
  ])('reports safe source-to-detection timing for %s %s only when meaningful', async (source, eventType, occurredAt, expectedLag) => {
    const event = { eventId: 'a'.repeat(64), source, eventType, occurredAt, detectedAt: '2026-10-19T20:21:01.000Z', familyId: 'family-a', childId: 'child-a' }
    const query = { where: () => query, orderBy: () => query, limit: () => query, select: () => query,
      get: async () => ({ docs: [{ data: () => event }] }) }
    const result = await listEvents({ collection: () => query }, '2026-10-19T20:20:00.000Z', {
      createInventory: () => ({ enumerate: async () => ({ complete: true, registeredChildren: [
        { familyId: 'family-a', childId: 'child-a', hasMeshAccount: true },
      ] }) }),
    })
    expect(result.events).toHaveLength(1)
    expect(result.events[0].sourceToDetectionMs).toBe(expectedLag)
    if (expectedLag === undefined) expect(result.events[0].sourceOccurredAt).toBeUndefined()
    else expect(result.events[0].sourceOccurredAt).toBe(occurredAt)
  })

  it('does not report an apparently complete event list from an incomplete owner inventory', async () => {
    const query = { where: () => query, orderBy: () => query, limit: () => query, select: () => query,
      get: async () => ({ docs: [] }) }
    await expect(listEvents({ collection: () => query }, '2026-10-19T20:20:00.000Z', {
      createInventory: () => ({ enumerate: async () => ({ complete: false, registeredChildren: [] }) }),
    })).rejects.toThrow('event_owner_unverified')
  })
})

it('keeps the private claim and progress when an unevidenced permission block is rejected', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'education-permission-rejected-')), out = output(), err = output()
  const store = { claimRequest: async () => ({ status: 'claimed' }), blockClaim: vi.fn(async () => ({ status: 'permission_evidence_required' })) }
  const deps = { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education', EDUCATION_SYNC_PROJECT_ROOT: root }, out, err,
    createDb: () => ({ terminate: async () => {} }), createStore: () => store }
  try {
    await main(['claim', '--request', REQUEST], deps)
    const claimPath = JSON.parse(out.value()).claimPath
    expect(await main(['block', '--request', REQUEST, '--claim-file', claimPath, '--reason', 'permission_required'], deps)).toBe(1)
    expect(existsSync(claimPath)).toBe(true)
    const progress = JSON.parse(readFileSync(resolve(root, '.local/education-sync-dispatch/work', REQUEST, 'progress.json'), 'utf8'))
    expect(progress.phase).toBe('claimed')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
