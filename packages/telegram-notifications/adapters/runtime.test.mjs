import { describe, expect, it } from 'vitest'
import { createRuntime } from './runtime.mjs'
import { createTelemetry } from '../../education-runtime/telemetry.mjs'

function fakeDb() {
  const ref = (path) => ({ id: path.split('/').at(-1), path })
  const collection = (path) => ({ doc: (id = 'auto') => ref(`${path}/${id}`) })
  return { collection, doc: ref, getAll: async () => [], runTransaction: async () => {}, terminate: async () => {} }
}

const config = { token: '12345:abcdefghijklmnopqrstuvwxyz_1234567890', projectId: 'petr-education',
  instanceId: 'worker', meshConnectionDirectory: '/tmp/test-mesh-connections', meshPollMs: 900_000 }

describe('source runtime wiring', () => {
  it('keeps all sources off unless explicitly enabled', () => {
    const runtime = createRuntime(config, { firestore: fakeDb() })
    expect(runtime.sourceCoordinator).toBeNull()
  })

  it('wires Firestore and Mesh pipelines through one dynamic coordinator', () => {
    const runtime = createRuntime(config, { firestore: fakeDb(), enableFirestoreSource: true, enableMeshSource: true })
    expect([...runtime.sourceCoordinator.sources.keys()]).toEqual(['firestore', 'mesh'])
    expect(Object.keys(runtime.sourceCoordinator.pipelines)).toEqual(['firestore', 'mesh'])
  })

  it('wraps source processing in shared spans with opaque scope identifiers', async () => {
    const telemetry = createTelemetry()
    const runtime = createRuntime(config, { firestore: fakeDb(), telemetry, enableFirestoreSource: true })
    await expect(runtime.sourceCoordinator.pipelines.firestore.process({ familyId: 'family-secret', childId: 'child-secret' }, { origin: 'invalid' }))
      .rejects.toThrow('invalid_source_origin')
    const trace = telemetry.snapshot()
    expect(trace.spans['telegram.source-pipeline.process'].count).toBe(1)
    const span = telemetry.snapshot()
    expect(JSON.stringify(span)).not.toContain('family-secret')
    expect(JSON.stringify(span)).not.toContain('child-secret')
  })
})
