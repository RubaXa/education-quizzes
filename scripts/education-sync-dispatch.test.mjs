import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { enqueueExistingEvent, listEvents, main } from './education-sync-dispatch.mjs'

const REQUEST = '01a150dc-e067-7cc2-b08f-f573bf83e6e3'

function output() { let value = ''; return { write: (part) => { value += part }, value: () => value } }

describe('education sync dispatch CLI', () => {
  it('reports action backlog and its independent lane without leaking private claim fields', async () => {
    const out = output()
    const state = { status: 'blocked', generation: 162, sendingGeneration: 19, pendingKinds: ['mesh', 'action', 'action', 'unknown'],
      sendingKinds: ['mesh'], blockedReasonCode: 'source_unavailable', completedActionGeneration: 18,
      pendingActionAfterGeneration: 18, pendingActionThroughGeneration: 43, claimTokenHash: 'PRIVATE_HASH',
      actionLane: { status: 'running', requestId: REQUEST, actionAfterGeneration: 18, actionThroughGeneration: 43,
        claimTokenHash: 'PRIVATE_LANE_HASH', sourcePayload: 'PRIVATE_PAYLOAD' } }
    expect(await main(['status'], { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education' }, out, err: output(),
      createDb: () => ({ terminate: async () => {} }), createStore: () => ({ read: async () => state }) })).toBe(0)
    expect(JSON.parse(out.value())).toMatchObject({ status: 'blocked', pendingKinds: ['mesh', 'action'],
      completedActionGeneration: 18, pendingActionThroughGeneration: 43,
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
      expect(await main(['complete', '--request', REQUEST, '--claim-file', claimPath], deps)).toBe(0)
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
      await main(['block', '--request', REQUEST, '--claim-file', claimPath, '--reason', 'permission_required'], deps)
      expect(store.blockClaim).toHaveBeenCalledWith(expect.objectContaining({ requestId: REQUEST, reasonCode: 'permission_required' }))
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
