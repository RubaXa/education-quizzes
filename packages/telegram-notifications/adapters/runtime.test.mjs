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

  it('queues only accepted natural Mesh events when delivery is active', async () => {
    const queued = []
    const dispatcher = { enqueueMeshChange: async (eventId) => queued.push(eventId), runOne: async () => false }
    const runtime = createRuntime({ ...config, educationSync: { threadId: '01a150dc-e067-7cc2-b08f-f573bf83e6e3',
      codexPath: '/opt/codex', projectRoot: '/workspace/PETR', remote: null } }, {
      firestore: fakeDb(), enableMeshSource: true, enableDelivery: true,
      educationSyncDispatcherFactory: () => dispatcher,
    })
    runtime.notificationService.accept = async () => ({ status: 'accepted' })
    await runtime.sourceCoordinator.pipelines.mesh.accept({ source: 'mesh', eventId: 'a'.repeat(64), eventType: 'grade.changed' })
    await runtime.sourceCoordinator.pipelines.mesh.accept({ source: 'mesh', eventId: 'b'.repeat(64), eventType: 'technical.probe' })
    await runtime.sourceCoordinator.pipelines.mesh.accept({ source: 'firestore', eventId: 'c'.repeat(64), eventType: 'grade.changed' })
    expect(queued).toEqual(['a'.repeat(64)])
  })
})
