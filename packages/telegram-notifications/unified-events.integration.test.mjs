import { describe, expect, it, vi } from 'vitest'
import { createFirestoreSourceAdapter } from './adapters/source-firestore.mjs'
import { SourcePipeline } from './application/source-pipeline.mjs'
import { createEducationEventHandlers } from './application/education-event-routing.mjs'
import { createDomainEvent } from './domain/events.mjs'
import { renderEvent } from './domain/renderer.mjs'
import { createMemoryStore } from './adapters/memory.mjs'
import { NotificationService } from './application/notifications.mjs'
import { normalizeEducationEvent, publishEducationEvent } from '../education-runtime/event-queue.mjs'

/** @see ../../docs/modules/synchronization/event-queue.md#миграция-и-проверки */
describe('queue event to actual source projection', () => {
  it('preserves normalized Mesh identity through queue sanitization and NotificationService re-normalization', async () => {
    const original = createDomainEvent({ source: 'mesh', eventType: 'grade.created', familyId: 'family-a', childId: 'child-a',
      scopeKey: 'mesh-scope-revision', sourceEventKey: 'mesh-grade-41', sourceRevision: 'grade-revision-1',
      detectedAt: '2026-10-19T10:00:00.000Z', occurredAt: '2026-10-19T09:00:00.000Z', privacyClass: 'family-summary',
      fields: { subject: 'Математика', title: 'Контрольная', value: '5' } })
    const rows = new Map()
    const db = {
      collection(name) {
        return { doc(id) { return { id, async get() {
          const value = rows.get(`${name}/${id}`)
          return { exists: value !== undefined, data: () => value }
        } } } }
      },
      async runTransaction(work) {
      const tx = { async get(ref) { const value = rows.get(`educationEvents/${ref.id}`); return { exists: value !== undefined, data: () => value } },
        create(ref, value) { rows.set(`educationEvents/${ref.id}`, value) } }
      return work(tx)
      },
    }
    const sourceRef = { kind: 'mesh', documentPath: `meshEvents/${original.scopeKey}/${original.sourceEventKey}` }
    const { eventId } = await publishEducationEvent(db, { source: 'mesh', sourceRef, familyId: original.familyId,
      childId: original.childId, actor: { type: 'system', id: 'mesh' }, operationId: original.sourceRevision,
      eventType: original.eventType, payload: original }, { timestamp: original.detectedAt })
    const queueEvent = await normalizeEducationEvent(rows.get(`educationEvents/${eventId}`))
    const store = createMemoryStore()
    const notificationService = new NotificationService({ eventLedger: store.eventLedger, outbox: store.outbox,
      recipients: { async resolveVerified() { return [] } }, membership: { async isActiveMember() { return false } },
      renderer: renderEvent, delivery: { async send() { throw new Error('no recipient expected') } },
      clock: () => new Date('2026-10-19T10:00:00.000Z'), workerId: 'identity-test' })
    const notify = createEducationEventHandlers({ notificationService })[queueEvent.eventType]
      .find((phase) => phase.phase === 'telegram-notification')
    await notify.handle(queueEvent)
    expect(queueEvent.payload.identityEncoding).toBe('sha256-v1')
    expect(store.events.has(original.eventId)).toBe(true)
    expect([...store.events.keys()]).toEqual([original.eventId])
  })

  it('notifies a first live upload without inventory or source subscriptions, then deduplicates replay', async () => {
    const token = 'dayabcdefghijklmnopqr'
    const rows = new Map(Object.entries({
      'families/family': { active: true },
      'families/family/children/child': { displayName: 'Ученик' },
      [`dayOwners/${token}`]: { familyId: 'family', childId: 'child', date: '2026-10-19', targetDate: '2026-10-20' },
      [`dayPages/${token}`]: { kind: 'student', familyId: 'family', childId: 'child', date: '2026-10-19',
        targetDate: '2026-10-20', taskIds: ['task'], subjects: [{ name: 'Математика', tasks: [{ id: 'task', title: 'Уравнение' }] }] },
      [`dayUploads/${token}/files/file`]: { status: 'pending', taskId: 'task', storage: { provider: 'yandex-disk', state: 'stored', syncedAt: '2026-10-19T10:00:00.000Z' } },
    }))
    const reads = []
    const snapshot = (path) => ({ exists: rows.has(path), data: () => rows.get(path) })
    const db = {
      doc: (path) => ({ path, get: async () => { reads.push(path); return snapshot(path) }, onSnapshot: () => { throw new Error('source subscription forbidden') } }),
      getAll: async (ref) => { reads.push(ref.path); return [snapshot(ref.path)] },
      collection: () => { throw new Error('global inventory forbidden') },
    }
    let baseline = null, sequence = 0
    const checkpoints = {
      acquire: async () => ({ acquired: true, leaseToken: 'lease', version: 1, sequence, baseline, pending: null }),
      savePending: async () => {}, renew: async () => true, release: async () => {}, invalidateOwner: async () => {},
      advance: async (value) => { baseline = value.baseline; sequence = value.sequence },
    }
    const accept = vi.fn(async () => ({ created: true, queued: 1 }))
    const source = createFirestoreSourceAdapter(db)
    const pipeline = new SourcePipeline({ source, checkpoints, accept, workerId: 'test', clock: () => new Date('2026-10-19T10:00:01.000Z') })
    const enqueueAction = vi.fn(async () => ({ status: 'accepted' }))
    const handlers = createEducationEventHandlers({ firestorePipeline: pipeline, educationSyncDispatcher: { enqueueAction } })
    const event = { eventId: 'a'.repeat(64), schemaVersion: 1, eventType: 'upload.confirmed', source: 'firestore', familyId: 'family', childId: 'child',
      sourceRef: { kind: 'upload', documentPath: `dayUploads/${token}/files/file`, dayToken: token, recordId: 'file', taskId: 'task' } }
    for (const phase of handlers[event.eventType]) await phase.handle(event)
    expect(accept).toHaveBeenCalledOnce()
    expect(accept.mock.calls[0][0]).toMatchObject({ eventType: 'upload.confirmed', fields: { childName: 'Ученик', subject: 'Математика', title: 'Уравнение' } })
    expect(enqueueAction).toHaveBeenCalledExactlyOnceWith(event)
    for (const phase of handlers[event.eventType]) await phase.handle(event)
    expect(accept).toHaveBeenCalledOnce()
    expect(reads.every((path) => rows.has(path))).toBe(true)
  })
})
