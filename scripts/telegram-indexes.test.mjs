import { describe, expect, it } from 'vitest'
import { createIndexManager, runIndexCommand, validateManifest } from './telegram-indexes.mjs'

const manifest = { indexes: [
  { collectionGroup: 'telegramNotificationOutbox', queryScope: 'COLLECTION', fields: [
    { fieldPath: 'state', order: 'ASCENDING' }, { fieldPath: 'nextAttemptAt', order: 'ASCENDING' }] },
  { collectionGroup: 'telegramNotificationOutbox', queryScope: 'COLLECTION', fields: [
    { fieldPath: 'state', order: 'ASCENDING' }, { fieldPath: 'leaseUntil', order: 'ASCENDING' }] },
] }

function fakeAdmin(initial = []) {
  const indexes = structuredClone(initial)
  const created = [], calls = []
  return {
    indexes, created, calls,
    async *listIndexesAsync({ parent }) {
      calls.push(['list', parent])
      for (const index of indexes.filter((item) => item.parent === parent)) {
        yield Object.fromEntries(Object.entries(index).filter(([key]) => key !== 'parent' && key !== 'collectionGroup'))
      }
    },
    async createIndex(request) {
      calls.push(['create', request.parent])
      created.push(request)
      indexes.push({ ...structuredClone(request.index), collectionGroup: request.parent.split('/').at(-1),
        parent: request.parent, state: 'CREATING' })
    },
    async close() { calls.push(['close']) },
  }
}

describe('scoped Telegram Firestore index tool', () => {
  it('validates only safe, explicit collection-scope composite index definitions', () => {
    expect(validateManifest(manifest)).toHaveLength(2)
    expect(() => validateManifest({ indexes: [{ ...manifest.indexes[0], collectionGroup: '../other' }] })).toThrow(/index_manifest_invalid/)
    expect(() => validateManifest({ indexes: [{ ...manifest.indexes[0], fields: [manifest.indexes[0].fields[0], manifest.indexes[0].fields[0]] }] })).toThrow(/index_manifest_invalid/)
  })

  it('lists and plans missing scoped indexes without writing or replacing project indexes', async () => {
    const unrelated = { collectionGroup: 'assignments', queryScope: 'COLLECTION', state: 'READY', fields: [] }
    const admin = fakeAdmin([{ ...unrelated, parent: 'projects/p/databases/(default)/collectionGroups/assignments' }])
    const outputs = []
    const dependencies = { cwd: '/fake', readManifest: () => manifest, clientFactory: () => admin,
      write: (value) => outputs.push(value) }
    const listed = await runIndexCommand(['list', '--project', 'safe-project'], dependencies)
    expect(listed.ready).toBe(false)
    const planned = await runIndexCommand(['plan', '--project', 'safe-project'], dependencies)
    expect(planned.createCount).toBe(2)
    expect(admin.created).toEqual([])
    expect(outputs.map((entry) => entry.operation)).toEqual(['list', 'plan'])
    expect(JSON.stringify(outputs)).not.toContain('credentials')
    expect(admin.indexes).toEqual([{ ...unrelated,
      parent: 'projects/p/databases/(default)/collectionGroups/assignments' }])
  })

  it('creates only absent manifest indexes and waits for exact indexes to become ready', async () => {
    const admin = fakeAdmin()
    let elapsed = 0, waits = 0
    const manager = createIndexManager({ client: admin, projectId: 'safe-project', expected: validateManifest(manifest),
      timeoutMs: 20, pollMs: 2, now: () => elapsed, sleep: async (ms) => {
        elapsed += ms
        waits += 1
        for (const index of admin.indexes) if (index.state === 'CREATING') index.state = 'READY'
      } })
    const plan = await manager.inspect()
    expect(plan.createCount).toBe(2)
    await manager.createMissing(plan)
    const ready = await manager.waitUntilReady()
    expect(ready.ready).toBe(true)
    expect(admin.created).toHaveLength(2)
    expect(admin.created.map(({ index }) => index.fields[1].fieldPath).sort()).toEqual(['leaseUntil', 'nextAttemptAt'])
    expect(admin.created.every(({ parent }) => parent === 'projects/safe-project/databases/(default)/collectionGroups/telegramNotificationOutbox')).toBe(true)
    expect(waits).toBe(1)
    expect(admin.calls.some(([method]) => method === 'delete')).toBe(false)
  })

  it('recognizes the Firestore Admin enum response and implicit document-name suffix', async () => {
    const first = manifest.indexes[0]
    const parent = 'projects/safe-project/databases/(default)/collectionGroups/telegramNotificationOutbox'
    const admin = fakeAdmin([{ ...first, queryScope: 1, state: 2,
      fields: [...first.fields.map((field) => ({ ...field, order: 1 })), { fieldPath: '__name__', order: 1 }], parent }])
    const manager = createIndexManager({ client: admin, projectId: 'safe-project', expected: validateManifest(manifest) })
    const result = await manager.inspect()
    expect(result.readyCount).toBe(1)
    expect(result.createCount).toBe(1)
    expect(result.indexes[0].state).toBe('READY')
  })

  it('returns nonzero when bounded readiness polling expires', async () => {
    const admin = fakeAdmin()
    const outputs = []
    const result = await runIndexCommand(['plan', '--project', 'safe-project', '--apply'], {
      cwd: '/fake', env: {}, readManifest: () => manifest, clientFactory: () => admin,
      write: (value) => outputs.push(value), timeoutMs: 0, pollMs: 1,
    })
    expect(result.exitCode).toBe(2)
    expect(result.ready).toBe(false)
    expect(result.notReadyCount).toBe(2)
    expect(admin.created).toHaveLength(2)
    expect(outputs[0].operation).toBe('plan')
  })

  it('does not accept apply for list or a missing project selection', async () => {
    await expect(runIndexCommand(['list', '--project', 'safe-project', '--apply'], { readManifest: () => manifest })).rejects.toMatchObject({ code: 'invalid_apply_mode' })
    await expect(runIndexCommand(['plan'], { readManifest: () => manifest })).rejects.toMatchObject({ code: 'firestore_project_required' })
  })

  it('sanitizes async Admin API iterator failures and retains only a numeric gRPC code', async () => {
    const admin = fakeAdmin()
    admin.listIndexesAsync = async function* () {
      yield* []
      const error = new Error('private request details with token-like data')
      error.code = 3
      throw error
    }
    const manager = createIndexManager({ client: admin, projectId: 'safe-project', expected: validateManifest(manifest) })
    const error = await manager.inspect().catch((reason) => reason)
    expect(error).toMatchObject({ code: 'invalid_argument', grpcCode: 3 })
    expect(error.message).toBe('invalid_argument')
  })
})
