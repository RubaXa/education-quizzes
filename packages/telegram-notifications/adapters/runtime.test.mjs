import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from './runtime.mjs'
import { createEducationEventHandlers } from '../application/education-event-routing.mjs'
import { createTelemetry } from '../../education-runtime/telemetry.mjs'

function fakeDb() {
  const listeners = []
  const ref = (path) => ({ id: path.split('/').at(-1), path, get: async () => ({ exists: false, data: () => undefined }) })
  const query = () => ({ where() { return this }, orderBy() { return this }, limit() { return this },
    async get() { return { docs: [] } }, onSnapshot(callback) { listeners.push(callback); callback({ docs: [] }); return () => { listeners.splice(listeners.indexOf(callback), 1) } } })
  const collection = (path) => ({ doc: (id = 'auto') => ref(`${path}/${id}`), where: () => query() })
  return { collection, doc: ref, listeners, getAll: async () => [], runTransaction: async () => {}, terminate: async () => {} }
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
