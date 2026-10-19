import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createRuntime } from './runtime.mjs'
import { runWorker } from './worker-loop.mjs'
import { createEducationEventHandlers } from '../application/education-event-routing.mjs'
import { createTelemetry } from '../../education-runtime/telemetry.mjs'

function fakeDb() {
  const listeners = []
  const ref = (path) => ({ id: path.split('/').at(-1), path, get: async () => ({ exists: false, data: () => undefined }) })
  const query = () => ({ where() { return this }, orderBy() { return this }, limit() { return this },
    async get() { return { docs: [], size: 0 } }, onSnapshot(callback) { listeners.push(callback); callback({ docs: [] }); return () => { listeners.splice(listeners.indexOf(callback), 1) } } })
  const collection = (path) => ({ doc: (id = 'auto') => ref(`${path}/${id}`), where: () => query() })
  return { collection, collectionGroup: () => query(), doc: ref, listeners, getAll: async () => [],
    runTransaction: async (callback) => callback({ get: async () => ({ exists: false, data: () => undefined }), create() {}, update() {} }),
    terminate: async () => {} }
}

const config = { token: '12345:abcdefghijklmnopqrstuvwxyz_1234567890', projectId: 'petr-education',
  instanceId: 'worker', meshConnectionDirectory: '/tmp/test-mesh-connections', meshPollMs: 900_000 }

describe('unified education event runtime wiring', () => {
  it('keeps source discovery out of Firestore and owns exactly one queue subscription', async () => {
    const db = fakeDb()
    const runtime = createRuntime(config, { firestore: db, enableFirestoreSource: true, enableMeshSource: true, enableDelivery: true })
    expect(runtime.sourceCoordinator.sources.has('firestore')).toBe(false)
    expect(runtime.sourceCoordinator.sources.has('mesh')).toBe(true)
    await runtime.educationEventConsumer.start()
    expect(db.listeners).toHaveLength(1)
    await runtime.educationEventConsumer.close()
    expect(db.listeners).toHaveLength(0)
  })

  it('keeps all source systems disabled unless explicitly enabled', () => {
    const runtime = createRuntime(config, { firestore: fakeDb() })
    expect(runtime.sourceCoordinator).toBeNull()
    expect(runtime.educationEventConsumer).toBeNull()
  })

  it('reports the queue only after Firestore acknowledges its initial subscription', async () => {
    const db = fakeDb()
    const info = vi.fn()
    const runtime = createRuntime(config, { firestore: db, enableDelivery: true, logger: { info, error: vi.fn() } })
    await runtime.educationEventConsumer.start()
    expect(info).toHaveBeenCalledWith({ code: 'education_event_queue_listening', source: 'educationEvents', subscriptionCount: 1, processId: process.pid })
    await runtime.educationEventConsumer.close()
  })

  it('keeps source-processing telemetry opaque', async () => {
    const telemetry = createTelemetry()
    const runtime = createRuntime(config, { firestore: fakeDb(), telemetry, enableFirestoreSource: true })
    await expect(runtime.firestorePipeline.process({ familyId: 'family-secret', childId: 'child-secret' }, { origin: 'invalid' }))
      .rejects.toThrow('invalid_source_origin')
    expect(JSON.stringify(telemetry.snapshot())).not.toContain('family-secret')
    expect(JSON.stringify(telemetry.snapshot())).not.toContain('child-secret')
  })

  it('constructs and instruments the fully enabled production runtime with a frozen legacy reconciler', async () => {
    const telemetry = createTelemetry()
    const runtimeConfig = { ...config, educationSync: {
      threadId: '01a150dc-e067-7cc2-b08f-f573bf83e6e3', codexPath: '/usr/local/bin/codex', projectRoot: '/tmp/petr-education',
    } }
    const runtime = createRuntime(runtimeConfig, { firestore: fakeDb(), telemetry, enableFirestoreSource: true,
      enableMeshSource: true, enableDelivery: true, uploadDisk: { request: vi.fn() } })

    expect(runtime.educationEventConsumer).toBeTruthy()
    expect(runtime.educationSyncDispatcher).toBeTruthy()
    expect(runtime.uploadReconciler).toBeTruthy()
    expect(runtime.legacyEventReconciler).toBeTruthy()
    expect(Object.isFrozen(Object.getPrototypeOf(runtime.legacyEventReconciler))).toBe(true)
    expect(runtime.legacyEventReconciler.runOne).not.toBe(Object.getPrototypeOf(runtime.legacyEventReconciler).runOne)
    expect(typeof runtime.uploadReconciler.runOne).toBe('function')
    await runtime.uploadReconciler.runOne()
    await runtime.legacyEventReconciler.runOne()
    expect(telemetry.snapshot().spans).toHaveProperty('telegram.upload.reconcile')
    expect(telemetry.snapshot().spans).toHaveProperty('telegram.education-event.legacy-reconcile')
  })

  it('starts the real event consumer through the worker and shuts down within the configured bound', async () => {
    const db = fakeDb()
    const telemetry = createTelemetry()
    const runtime = createRuntime(config, { firestore: db, telemetry, enableFirestoreSource: true, enableDelivery: true })
    const processLike = new EventEmitter()
    processLike.exitCode = 0
    const logger = { info() {}, error: vi.fn() }
    let finishPolling
    runtime.telegram.start = () => new Promise((resolve) => { finishPolling = resolve })
    runtime.telegram.stop = vi.fn(async () => finishPolling?.())

    const worker = runWorker({ runtime, enableDelivery: true, logger, processLike, shutdownMs: 250, shutdownCleanupMs: 100 })
    await vi.waitFor(() => expect(db.listeners).toHaveLength(1))
    expect(runtime.educationEventConsumer).toBeTruthy()
    expect(runtime.educationEventConsumer.runOne.__workerWatchdog).toBe(true)
    expect(runtime.educationEventConsumer.runOne.__operationDeadline).toBe(true)
    expect(runtime.telegram.stop).not.toHaveBeenCalled()

    processLike.emit('SIGTERM')
    await expect(worker).resolves.toEqual({ ok: true })
    expect(runtime.telegram.stop).toHaveBeenCalledOnce()
    expect(db.listeners).toHaveLength(0)
  })

  it('routes Mesh queue events through notification and the shared EducationSync dispatcher', async () => {
    const notificationService = { accept: vi.fn(async () => ({ created: true, queued: 1, nextDueAt: '2026-10-19T10:00:30.000Z' })) }
    const educationSyncDispatcher = { enqueueMeshChange: vi.fn(async () => ({ status: 'accepted', nextDueAt: '2026-10-19T10:00:20.000Z' })) }
    const deliveryWake = vi.fn(), syncWake = vi.fn()
    const routes = createEducationEventHandlers({ notificationService, educationSyncDispatcher,
      onDeliveryQueued: deliveryWake, onEducationSyncQueued: syncWake })
    const event = { source: 'mesh', eventId: 'a'.repeat(64), eventType: 'grade.changed', familyId: 'f1', childId: 'c1',
      payload: { eventId: 'e'.repeat(64), sourceEventKey: 'b'.repeat(64), sourceRevision: 'c'.repeat(64), scopeKey: 'd'.repeat(64) } }
    for (const item of routes['grade.changed']) await item.handle(event)
    expect(notificationService.accept).toHaveBeenCalledOnce()
    expect(educationSyncDispatcher.enqueueMeshChange).toHaveBeenCalledExactlyOnceWith(event.payload.eventId)
    expect(deliveryWake).toHaveBeenCalledOnce()
    expect(syncWake).toHaveBeenCalledOnce()
  })
})
