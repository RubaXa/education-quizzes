import { describe, expect, it } from 'vitest'
import { runTechnicalProbe } from './probe-runner.mjs'

const now = () => new Date('2026-10-17T10:00:00.000Z')
const request = { kind: 'firestore', familyId: 'family-a', childId: 'child-a', targetDigest: 'a'.repeat(16), runId: 'run-1' }
function fakeDb() {
  const rows = new Map(), listeners = new Map()
  const ref = (path) => ({ id: path.split('/').at(-1), async get() { const row = rows.get(path); return { exists: Boolean(row), data: () => row } },
    async create(row) { if (rows.has(path)) throw new Error('already_exists'); rows.set(path, structuredClone(row)); for (const callback of listeners.get(path) ?? []) callback({ exists: true, data: () => rows.get(path) }) },
    async update(update) { if (!rows.has(path)) throw new Error('missing'); rows.set(path, { ...rows.get(path), ...update }); for (const callback of listeners.get(path) ?? []) callback({ exists: true, data: () => rows.get(path) }) },
    onSnapshot(callback) { const current = listeners.get(path) ?? []; current.push(callback); listeners.set(path, current); queueMicrotask(() => callback({ exists: rows.has(path), data: () => rows.get(path) })); return () => listeners.set(path, current.filter((item) => item !== callback)) },
  })
  return { rows, doc: ref }
}
function dependencies(db, { mesh = false } = {}) {
  const checkpoints = {
    async acquire() { return { acquired: true, leaseToken: 'lease', version: 0, sequence: 0, baseline: null, pending: null } },
    async savePending() {}, async advance() {}, async renew() {}, async release() {}, async invalidateOwner() {},
  }
  const accepted = []
  return { accepted, db, checkpoints,
    recipientResolver: { async resolve() { return { linkId: 'safe-link', personId: 'parent-a', telegramUserId: '12345', familyId: 'family-a', childId: 'child-a' } } },
    probeNotifications: { async accept(event, context) { accepted.push({ event, context }); return { status: 'queued', queued: 1, eventId: 'event-id', jobId: 'event-id_safe-link' } } },
    meshSource: mesh ? { async validateScope() { return true }, async observe() { return { completeness: 'complete', familyId: 'family-a', childId: 'child-a', records: [{ private: 'ignored' }] } } } : null,
    async deliver(jobId) { expect(jobId).toBe('event-id_safe-link'); return true },
    async readDeliveryReceipt(jobId) { expect(jobId).toBe('event-id_safe-link'); return { state: 'sent', partReceipts: [{ messageId: 99 }] } },
  }
}

describe('technical probe orchestration', () => {
  it('dry-runs without writes or delivery', async () => {
    const db = fakeDb(), deps = dependencies(db)
    await expect(runTechnicalProbe({ ...request, db, ...deps, checkpoints: deps.checkpoints, clock: now })).resolves.toMatchObject({ status: 'ready' })
    expect(db.rows.size).toBe(0)
    expect(deps.accepted).toHaveLength(0)
  })

  it('applies exactly one technical event and verifies the sent receipt readback', async () => {
    const db = fakeDb(), deps = dependencies(db)
    const result = await runTechnicalProbe({ ...request, db, ...deps, checkpoints: deps.checkpoints, clock: now, apply: true })
    expect(result).toEqual({ status: 'completed', kind: 'firestore', runId: 'run-1', eventId: 'event-id', deliveryState: 'sent', receiptParts: 1 })
    expect(deps.accepted).toHaveLength(1)
    expect(deps.accepted[0].event).toMatchObject({ eventType: 'technical.probe', fields: {} })
    expect(deps.accepted[0].context).toEqual({ targetDigest: request.targetDigest })
    expect(db.rows.get('telegramOperationalProbes/run-1')).toMatchObject({ status: 'completed', telegramReceiptId: 99 })
  })

  it('refuses a reused runId and requires a complete Mesh read before delivery', async () => {
    const db = fakeDb(), deps = dependencies(db)
    db.rows.set('telegramOperationalProbes/run-1', { status: 'completed' })
    await expect(runTechnicalProbe({ ...request, db, ...deps, checkpoints: deps.checkpoints, clock: now, apply: true })).rejects.toMatchObject({ safeCode: 'probe_run_exists' })
    const meshDb = fakeDb(), meshDeps = dependencies(meshDb, { mesh: true })
    meshDeps.meshSource.observe = async () => ({ completeness: 'partial', records: [] })
    await expect(runTechnicalProbe({ ...request, kind: 'mesh', meshScope: { source: 'mesh', familyId: 'family-a', childId: 'child-a' },
      db: meshDb, ...meshDeps, checkpoints: meshDeps.checkpoints, clock: now, apply: true })).rejects.toMatchObject({ safeCode: 'probe_pipeline_incomplete' })
  })
})
