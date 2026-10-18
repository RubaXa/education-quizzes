import { describe, expect, it } from 'vitest'
import { createProbeScope, createTechnicalProbeSource } from './probe-source.mjs'

const now = new Date('2026-10-17T10:00:00.000Z')
const targetDigest = 'a'.repeat(16)
function probeDb(row) {
  const listeners = []
  return {
    listeners,
    doc(path) { return {
      async get() { return { exists: Boolean(row), data: () => row } },
      onSnapshot(callback) { listeners.push({ path, callback }); callback({ exists: Boolean(row), data: () => row }); return () => {} },
    } },
  }
}
const row = (overrides = {}) => ({ status: 'requested', source: 'firestore', runId: 'run-1',
  familyId: 'family-a', childId: 'child-a', targetDigest, expiresAt: new Date(now.valueOf() + 60_000), ...overrides })
const scope = (kind = 'firestore', meshScope) => createProbeScope({ kind, runId: 'run-1', targetDigest,
  familyId: 'family-a', childId: 'child-a', meshScope })

describe('technical probe source', () => {
  it('listens to the addressed Firestore probe doc and emits one fixed technical observation', async () => {
    const db = probeDb(row())
    const source = createTechnicalProbeSource({ kind: 'firestore', db,
      recipientResolver: { async resolve(input) { expect(input.digest).toBe(targetDigest); return { familyId: 'family-a', childId: 'child-a' } } },
      clock: () => now })
    const target = scope()
    let signaled = 0
    const stop = source.subscribe({ scopes: [target], onSignal: async () => { signaled += 1 } })
    const observation = await source.observe(target)
    expect(db.listeners).toHaveLength(1)
    expect(db.listeners[0].path).toBe('telegramOperationalProbes/run-1')
    expect(signaled).toBe(1)
    expect(observation).toMatchObject({ completeness: 'complete', source: 'firestore', familyId: 'family-a', childId: 'child-a' })
    expect(observation.records).toHaveLength(1)
    expect(observation.records[0]).toMatchObject({ kind: 'probe', eventType: 'technical.probe', fields: {} })
    await stop()
  })

  it('refuses expired, wrong-scope, or non-exact recipient requests', async () => {
    for (const invalid of [row({ expiresAt: new Date(now.valueOf() - 1) }), row({ familyId: 'family-b' }), row({ targetDigest: 'b'.repeat(16) })]) {
      const source = createTechnicalProbeSource({ kind: 'firestore', db: probeDb(invalid),
        recipientResolver: { async resolve() { return { familyId: 'family-a', childId: 'child-a' } } }, clock: () => now })
      await expect(source.observe(scope())).resolves.toMatchObject({ completeness: 'partial', records: [] })
    }
  })

  it('reads complete Mesh data but persists only one technical probe record and a count metric', async () => {
    const db = probeDb(row({ source: 'mesh' }))
    let observations = 0, metric
    const meshSource = {
      async validateScope() { return true },
      async observe() { observations += 1; return { completeness: 'complete', familyId: 'family-a', childId: 'child-a', records: [{ value: 'must-not-escape' }, { value: 'also-private' }] } },
    }
    const source = createTechnicalProbeSource({ kind: 'mesh', db, meshSource,
      recipientResolver: { async resolve() { return { familyId: 'family-a', childId: 'child-a' } } },
      clock: () => now, onMeshObservation(value) { metric = value } })
    const meshScope = { source: 'mesh', familyId: 'family-a', childId: 'child-a', sourceAccountId: 'account-a', sourcePersonId: 'child-a' }
    const observation = await source.observe(scope('mesh', meshScope))
    expect(observations).toBe(1)
    expect(metric).toEqual({ complete: true, recordCount: 2 })
    expect(JSON.stringify(observation)).not.toContain('must-not-escape')
    expect(observation.records).toEqual([{ recordKey: expect.any(String), kind: 'probe', eventType: 'technical.probe', fields: {} }])
  })
})
