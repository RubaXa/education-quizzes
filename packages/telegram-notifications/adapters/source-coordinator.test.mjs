import { describe, expect, it, vi } from 'vitest'
import { SourceCoordinator } from './source-coordinator.mjs'

function harness() {
  const scopes = new Map()
  const processed = []
  const health = []
  const source = {
    kind: 'firestore',
    scopeKey: (scope) => scope.key,
    subscribe: vi.fn(({ scopes: list, onSignal }) => {
      const entries = list.map((scope) => [scope.key, { scope, onSignal }])
      for (const [key, value] of entries) scopes.set(key, value)
      return async () => { for (const [key, value] of entries) if (scopes.get(key) === value) scopes.delete(key) }
    }),
  }
  const pipeline = { process: vi.fn(async (scope, options) => { processed.push([scope.key, options.origin]) }) }
  const coordinator = new SourceCoordinator({ sources: [source], pipelines: { firestore: pipeline },
    enumerate: async () => ({ complete: true, scopes: [] }), onHealth: (event) => health.push(event),
    reconcileMs: 60_000, random: () => 0 })
  return { coordinator, source, pipeline, scopes, processed, health }
}

describe('SourceCoordinator', () => {
  it('subscribes before processing and adds newly discovered scopes without restart', async () => {
    const h = harness()
    let inventory = { complete: true, families: [{ familyId: 'fam-a' }], scopes: [{ source: 'firestore', scope: { key: 'child-a', familyId: 'fam-a' }, origin: 'bootstrap' }] }
    h.coordinator.enumerate = async () => inventory
    await h.coordinator.start()
    expect(h.source.subscribe).toHaveBeenCalledOnce()
    expect(h.scopes.has('child-a')).toBe(true)
    await vi.waitFor(() => expect(h.processed).toContainEqual(['child-a', 'bootstrap']))

    inventory = { complete: true, families: [{ familyId: 'fam-a' }], scopes: [
      { source: 'firestore', scope: { key: 'child-a', familyId: 'fam-a' }, origin: 'bootstrap' },
      { source: 'firestore', scope: { key: 'child-b', familyId: 'fam-a' }, origin: 'live' },
    ] }
    await h.coordinator.reconcile()
    await vi.waitFor(() => expect(h.processed).toContainEqual(['child-b', 'live']))
    expect(h.scopes.has('child-a')).toBe(true)
    expect(h.scopes.has('child-b')).toBe(true)
    await h.coordinator.close()
  })

  it('coalesces overlapping reconciliations into one in-flight inventory confirmation', async () => {
    const h = harness()
    let calls = 0, release
    const gate = new Promise((resolve) => { release = resolve })
    h.coordinator.enumerate = async () => {
      calls++
      await gate
      return { complete: true, families: [{ familyId: 'fam-a' }], scopes: [] }
    }
    const first = h.coordinator.start()
    await vi.waitFor(() => expect(calls).toBe(1))
    const second = h.coordinator.reconcile()
    expect(calls).toBe(1)
    release()
    await Promise.all([first, second])
    expect(calls).toBe(1)
    await h.coordinator.close()
  })

  it('keeps confirmed listeners on partial inventory and reports a safe health code', async () => {
    const h = harness()
    h.coordinator.enumerate = async () => ({ complete: true, families: [{ familyId: 'fam-a' }], scopes: [{ source: 'firestore', scope: { key: 'family-a', familyId: 'fam-a' } }] })
    await h.coordinator.start()
    expect(h.scopes.has('family-a')).toBe(true)
    h.coordinator.enumerate = async () => ({ complete: false, failedFamilyCount: 1, families: [], scopes: [] })
    await expect(h.coordinator.reconcile()).resolves.toMatchObject({ status: 'partial' })
    expect(h.scopes.has('family-a')).toBe(true)
    expect(h.health).toContainEqual({ code: 'inventory_partial', source: 'firestore', failedFamilies: 1 })
    await h.coordinator.close()
  })

  it('merges scopes from healthy families while retaining scopes from failed families', async () => {
    const h = harness()
    h.coordinator.enumerate = async () => ({ complete: true, families: [{ familyId: 'fam-a' }],
      scopes: [{ source: 'firestore', scope: { key: 'a', familyId: 'fam-a' } }] })
    await h.coordinator.start()
    h.coordinator.enumerate = async () => ({ complete: false, failedFamilyCount: 1,
      families: [{ familyId: 'fam-b' }], scopes: [
        { source: 'firestore', scope: { key: 'b', familyId: 'fam-b' } },
      ] })
    await h.coordinator.reconcile()
    expect(h.scopes.has('a')).toBe(true)
    expect(h.scopes.has('b')).toBe(true)
    await h.coordinator.close()
  })

  it('retains only failed source-child scopes while refreshing healthy sources and siblings', async () => {
    const watched = new Map()
    const makeSource = (kind) => ({ kind, scopeKey: (scope) => scope.key,
      subscribe: ({ scopes: list, onSignal }) => {
        const entries = list.map((scope) => [scope.key, { scope, onSignal }])
        for (const [key, value] of entries) watched.set(`${kind}:${key}`, value)
        return async () => { for (const [key, value] of entries) if (watched.get(`${kind}:${key}`) === value) watched.delete(`${kind}:${key}`) }
      } })
    const firestore = makeSource('firestore'), mesh = makeSource('mesh')
    const coordinator = new SourceCoordinator({ sources: [firestore, mesh], pipelines: {
      firestore: { process: async () => ({ status: 'advanced' }) }, mesh: { process: async () => ({ status: 'advanced' }) },
    }, enumerate: async () => ({ complete: true, families: [{ familyId: 'fam-a' }], scopes: [
      { source: 'firestore', scope: { key: 'fs-kid-a', familyId: 'fam-a', childId: 'kid-a' } },
      { source: 'firestore', scope: { key: 'fs-kid-b', familyId: 'fam-a', childId: 'kid-b' } },
      { source: 'mesh', scope: { key: 'mesh-kid-a', familyId: 'fam-a', childId: 'kid-a', sourceAccountId: 'account-a' } },
      { source: 'mesh', scope: { key: 'mesh-kid-b', familyId: 'fam-a', childId: 'kid-b', sourceAccountId: 'account-b' } },
    ] }), reconcileMs: 60_000 })
    await coordinator.start()
    coordinator.enumerate = async () => ({ complete: false, failedFamilyCount: 1,
      families: [{ familyId: 'fam-a' }], failedContexts: [{ source: 'mesh', familyId: 'fam-a', childId: 'kid-a', sourceAccountId: 'account-a' }],
      scopes: [
        { source: 'firestore', scope: { key: 'fs-kid-a', familyId: 'fam-a', childId: 'kid-a' } },
        { source: 'firestore', scope: { key: 'fs-kid-b', familyId: 'fam-a', childId: 'kid-b' } },
        { source: 'mesh', scope: { key: 'mesh-kid-b-new', familyId: 'fam-a', childId: 'kid-b', sourceAccountId: 'account-b' } },
      ] })
    await coordinator.reconcile()
    expect([...coordinator.known.get('firestore').keys()].sort()).toEqual(['fs-kid-a', 'fs-kid-b'])
    expect([...coordinator.known.get('mesh').keys()].sort()).toEqual(['mesh-kid-a', 'mesh-kid-b-new'])
    expect(watched.has('mesh:mesh-kid-a')).toBe(true)
    expect(watched.has('mesh:mesh-kid-b-new')).toBe(true)
    await coordinator.close()
  })

  it('coalesces duplicate wakeups and stops accepting new work at close', async () => {
    const h = harness()
    h.coordinator.concurrency = 1
    h.coordinator.enumerate = async () => ({ complete: true, families: [{ familyId: 'fam-a' }], scopes: [{ source: 'firestore', scope: { key: 'same', familyId: 'fam-a' } }] })
    await h.coordinator.start()
    const watched = h.scopes.get('same')
    let resolveWork
    h.pipeline.process.mockImplementation(() => new Promise((resolve) => { resolveWork = resolve }))
    watched.onSignal(watched.scope)
    watched.onSignal(watched.scope)
    await vi.waitFor(() => expect(resolveWork).toBeTypeOf('function'))
    expect(h.coordinator.pending.size).toBeLessThanOrEqual(1)
    const closing = h.coordinator.close()
    expect(h.coordinator.signal('firestore', watched.scope)).toBe(false)
    resolveWork()
    await closing
    expect(h.coordinator.pending.size).toBe(0)
  })

  it('retries incomplete observations without waiting for another source signal', async () => {
    const h = harness()
    const timers = new Map()
    let nextTimer = 0
    h.coordinator.setTimer = (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id }
    h.coordinator.clearTimer = (id) => timers.delete(id)
    h.coordinator.enumerate = async () => ({ complete: true, families: [{ familyId: 'fam-a' }],
      scopes: [{ source: 'firestore', scope: { key: 'retry', familyId: 'fam-a' } }] })
    h.pipeline.process.mockResolvedValueOnce({ status: 'incomplete', reasonCode: 'source_snapshot_too_large' }).mockResolvedValueOnce({ status: 'advanced' })
    await h.coordinator.start()
    await vi.waitFor(() => expect(h.pipeline.process).toHaveBeenCalledTimes(1))
    expect(h.health).toContainEqual(expect.objectContaining({ code: 'source_observation_blocked',
      reasonCode: 'source_snapshot_too_large', source: 'firestore' }))
    const retry = [...timers.entries()].find(([, timer]) => timer.ms >= 1_000 && timer.ms < 30_000)
    expect(retry).toBeDefined()
    timers.delete(retry[0])
    retry[1].fn()
    await vi.waitFor(() => expect(h.pipeline.process).toHaveBeenCalledTimes(2))
    await h.coordinator.close()
  })

  it('cancels retries when a scope disappears during reconciliation', async () => {
    const h = harness()
    const timers = new Map()
    let nextTimer = 0
    h.coordinator.setTimer = (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id }
    h.coordinator.clearTimer = (id) => timers.delete(id)
    h.coordinator.enumerate = async () => ({ complete: true, families: [{ familyId: 'fam-a' }],
      scopes: [{ source: 'firestore', scope: { key: 'removed', familyId: 'fam-a' } }] })
    h.pipeline.process.mockResolvedValue({ status: 'incomplete' })
    await h.coordinator.start()
    await vi.waitFor(() => expect(h.pipeline.process).toHaveBeenCalledTimes(1))
    const retry = [...timers.values()].find((timer) => timer.ms < 30_000)
    expect(retry).toBeDefined()
    h.coordinator.enumerate = async () => ({ complete: true, families: [{ familyId: 'fam-a' }], scopes: [] })
    await h.coordinator.reconcile()
    expect([...timers.values()].some((timer) => timer.ms < 30_000)).toBe(false)
    retry.fn()
    await Promise.resolve()
    expect(h.pipeline.process).toHaveBeenCalledTimes(1)
    await h.coordinator.close()
  })

  it('logs finite codes and hashed scope keys when a synchronous adapter error contains a secret', async () => {
    const h = harness()
    h.coordinator.enumerate = async () => ({ complete: true, families: [{ familyId: 'fam-a' }],
      scopes: [{ source: 'firestore', scope: { key: 'a'.repeat(64), familyId: 'fam-a' } }] })
    h.pipeline.process.mockImplementation(() => { throw new Error('credential-secret') })
    await h.coordinator.start()
    await vi.waitFor(() => expect(h.pipeline.process).toHaveBeenCalled())
    await vi.waitFor(() => expect(h.health.some((entry) => entry.code === 'source_observation_failed')).toBe(true))
    const log = JSON.stringify(h.health)
    expect(log).not.toContain('credential-secret')
    expect(h.health.find((entry) => entry.code === 'source_observation_failed')).toMatchObject({
      source: 'firestore', scopeKey: expect.stringMatching(/^[a-f0-9]{64}$/), errorCode: 'source_error',
    })
    await h.coordinator.close()
  })

  it('waits for an in-progress inventory and unsubscribes late listeners before close resolves', async () => {
    const h = harness()
    let discoverySignal, enumerateSignal, confirmEntered
    const entered = new Promise((resolve) => { confirmEntered = resolve })
    h.coordinator.discoveryStore = { prepare: async (inventory, { signal }) => {
      expect(signal).toBe(h.coordinator.abortSignal)
      return { ...inventory, scopes: inventory.scopes }
    }, confirm: async (prepared, { signal }) => {
      discoverySignal = signal
      confirmEntered()
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      return { scopes: prepared.scopes }
    } }
    h.coordinator.enumerate = async ({ signal }) => {
      enumerateSignal = signal
      return { complete: true, families: [{ familyId: 'fam-a' }],
        scopes: [{ source: 'firestore', scope: { key: 'late', familyId: 'fam-a' } }] }
    }
    const starting = h.coordinator.start()
    await entered
    expect(enumerateSignal).toBe(h.coordinator.abortSignal)
    expect(discoverySignal).toBe(h.coordinator.abortSignal)
    const closing = h.coordinator.close()
    await Promise.all([starting, closing])
    expect(discoverySignal.aborted).toBe(true)
    expect(h.scopes.has('late')).toBe(false)
    expect(h.health).not.toContainEqual(expect.objectContaining({ code: 'inventory_unavailable' }))
  })

  it('passes its close signal to baseline pipeline work and suppresses abort health', async () => {
    const h = harness()
    h.coordinator.enumerate = async () => ({ complete: true, families: [{ familyId: 'fam-a' }],
      scopes: [{ source: 'firestore', scope: { key: 'abort-me', familyId: 'fam-a' } }] })
    let receivedSignal, finish
    h.pipeline.process.mockImplementation((_scope, { signal }) => {
      receivedSignal = signal
      return new Promise((resolve) => { finish = resolve })
    })
    await h.coordinator.start()
    await vi.waitFor(() => expect(receivedSignal).toBeDefined())
    const closing = h.coordinator.close()
    expect(receivedSignal).toBe(h.coordinator.abortSignal)
    expect(receivedSignal.aborted).toBe(true)
    finish({ status: 'incomplete' })
    await closing
    expect(h.health).toEqual([])
  })
})
