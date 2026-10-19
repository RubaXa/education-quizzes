import { describe, expect, it, vi } from 'vitest'
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
  it.each(['firestore', 'mesh'])('wakes %s consumers only after their durable writes finish', async (source) => {
    let acceptCommit, dispatchCommit
    const acceptance = new Promise((resolve) => { acceptCommit = resolve })
    const queued = new Promise((resolve) => { dispatchCommit = resolve })
    const enqueue = vi.fn(() => queued)
    const runtime = createRuntime({ ...config, educationSync: { threadId: '01a150dc-e067-7cc2-b08f-f573bf83e6e3',
      codexPath: '/opt/codex', projectRoot: '/workspace/PETR' } }, {
      firestore: fakeDb(), enableFirestoreSource: true, enableMeshSource: true, enableDelivery: true,
      educationSyncDispatcherFactory: () => ({ enqueueWorkChange: enqueue, enqueueMeshChange: enqueue, runOne: async () => false }),
    })
    const delivery = vi.fn(), educationSync = vi.fn()
    runtime.setWorkerWakeHandlers({ delivery, educationSync })
    runtime.notificationService.accept = () => acceptance
    const pending = runtime.sourceCoordinator.pipelines[source].accept({ source, eventId: 'a'.repeat(64),
      eventType: source === 'firestore' ? 'upload.confirmed' : 'grade.changed' })
    expect(delivery).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
    const deliveryDue = '2026-10-19T10:00:30.000Z'
    const syncDue = '2026-10-19T10:00:20.000Z'
    acceptCommit({ created: true, queued: 1, nextDueAt: deliveryDue })
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledOnce())
    expect(delivery).toHaveBeenCalledExactlyOnceWith(deliveryDue)
    expect(educationSync).not.toHaveBeenCalled()
    dispatchCommit({ status: 'accepted', nextDueAt: syncDue })
    await pending
    expect(educationSync).toHaveBeenCalledExactlyOnceWith(syncDue)

    delivery.mockClear(); educationSync.mockClear()
    runtime.notificationService.accept = async () => ({ created: false })
    enqueue.mockResolvedValue({ status: 'duplicate' })
    await runtime.sourceCoordinator.pipelines[source].accept({ source, eventId: 'b'.repeat(64),
      eventType: source === 'firestore' ? 'upload.confirmed' : 'grade.changed' })
    expect(delivery).not.toHaveBeenCalled()
    expect(educationSync).not.toHaveBeenCalled()
    runtime.notificationService.accept = async () => ({ created: true, queued: 0 })
    enqueue.mockResolvedValue({ status: 'accepted', generation: 2 })
    await runtime.sourceCoordinator.pipelines[source].accept({ source, eventId: 'c'.repeat(64),
      eventType: source === 'firestore' ? 'upload.confirmed' : 'grade.changed' })
    expect(delivery).not.toHaveBeenCalled()
    expect(educationSync).not.toHaveBeenCalled()
  })

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
    runtime.notificationService.accept = async () => ({ created: true, eventId: 'ledger-id' })
    await runtime.sourceCoordinator.pipelines.mesh.accept({ source: 'mesh', eventId: 'a'.repeat(64), eventType: 'grade.changed' })
    await runtime.sourceCoordinator.pipelines.mesh.accept({ source: 'mesh', eventId: 'b'.repeat(64), eventType: 'technical.probe' })
    await runtime.sourceCoordinator.pipelines.mesh.accept({ source: 'firestore', eventId: 'c'.repeat(64), eventType: 'grade.changed' })
    expect(queued).toEqual(['a'.repeat(64)])
  })

  it('queues accepted Firestore work events when delivery is active, even without Mesh enabled', async () => {
    const queued = []
    const dispatcher = { enqueueMeshChange: async (eventId) => queued.push(['mesh', eventId]),
      enqueueWorkChange: async (eventId) => queued.push(['work', eventId]), runOne: async () => false }
    const runtime = createRuntime({ ...config, educationSync: { threadId: '01a150dc-e067-7cc2-b08f-f573bf83e6e3',
      codexPath: '/opt/codex', projectRoot: '/workspace/PETR' } }, {
      firestore: fakeDb(), enableFirestoreSource: true, enableDelivery: true,
      educationSyncDispatcherFactory: () => dispatcher,
    })
    runtime.notificationService.accept = async () => ({ created: true, eventId: 'ledger-id' })
    const workEvent = { source: 'firestore', eventId: 'a'.repeat(64), eventType: 'upload.confirmed',
      scopeKey: 'b'.repeat(64), sourceEventKey: 'c'.repeat(64) }
    await runtime.sourceCoordinator.pipelines.firestore.accept(workEvent)
    const quizEvent = { ...workEvent, eventId: 'e'.repeat(64), sourceEventKey: 'f'.repeat(64), eventType: 'quiz.submitted' }
    await runtime.sourceCoordinator.pipelines.firestore.accept(quizEvent)
    runtime.notificationService.accept = async () => ({ created: false, eventId: 'ledger-id' })
    await runtime.sourceCoordinator.pipelines.firestore.accept(workEvent)
    for (const eventType of ['quiz.started', 'review.changed', 'technical.probe']) {
      await runtime.sourceCoordinator.pipelines.firestore.accept({ ...workEvent, eventType, eventId: 'd'.repeat(64) })
    }
    expect(queued).toEqual([['work', workEvent], ['work', quizEvent], ['work', workEvent]])
  })

  it('retries dispatch after a ledger duplicate replay if the first dispatcher write failed', async () => {
    let attempts = 0
    const runtime = createRuntime({ ...config, educationSync: { threadId: '01a150dc-e067-7cc2-b08f-f573bf83e6e3',
      codexPath: '/opt/codex', projectRoot: '/workspace/PETR' } }, {
      firestore: fakeDb(), enableFirestoreSource: true, enableDelivery: true,
      educationSyncDispatcherFactory: () => ({ enqueueWorkChange: async () => { attempts += 1; if (attempts === 1) throw new Error('temporary') }, runOne: async () => false }),
    })
    runtime.notificationService.accept = async () => ({ created: attempts === 0, eventId: 'ledger-id' })
    const event = { source: 'firestore', eventId: 'a'.repeat(64), eventType: 'upload.confirmed',
      scopeKey: 'b'.repeat(64), sourceEventKey: 'c'.repeat(64) }
    await expect(runtime.sourceCoordinator.pipelines.firestore.accept(event)).rejects.toThrow('temporary')
    expect(await runtime.sourceCoordinator.pipelines.firestore.accept(event)).toMatchObject({ created: false })
    expect(attempts).toBe(2)
  })
})
