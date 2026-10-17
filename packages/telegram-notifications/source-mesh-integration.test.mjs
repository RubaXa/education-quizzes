import { describe, expect, it } from 'vitest'
import { SourcePipeline } from './application/source-pipeline.mjs'
import { NotificationService } from './application/notifications.mjs'
import { createMeshSourceAdapter } from './adapters/source-mesh.mjs'
import { createMemoryStore } from './adapters/memory.mjs'
import { renderEvent } from './domain/renderer.mjs'

/** @see ../../docs/services/telegram-bot/adapters/mesh.md#контракт-снимка @see ../../docs/services/telegram-bot/ports-and-events.md#контракт-observation */
const now = '2026-10-17T12:00:00.000Z'
const scope = { source: 'mesh', familyId: 'family-a', childId: 'child-a', sourceAccountId: 'a'.repeat(64),
  sourcePersonId: 'mesh-student-a', kind: 'schedule', date: '2026-10-17' }
const lesson = (finishAt) => ({ id: 77, start_at: '2026-10-17T09:00:00+03:00', finish_at: finishAt,
  subject_id: 4, subject_name: 'Математика', cancelled: false, replaced: false })

describe('Mesh source to notification delivery', () => {
  it('baselines silently, then sends a source change through NotificationService and the outbox', async () => {
    let currentLesson = lesson('2026-10-17T09:45:00+03:00')
    const source = createMeshSourceAdapter({ resolver: {
      async validateScope() { return true },
      async withChildAdapter(_scope, run) { return run({ async getSchedule() { return [currentLesson] } }) },
    }, now: () => new Date(now), pollMs: 60_000, jitterMs: 0 })
    const checkpoints = new MemoryCheckpoints()
    const store = createMemoryStore()
    const deliveries = []
    const service = new NotificationService({
      eventLedger: store.eventLedger,
      outbox: store.outbox,
      recipients: { async resolveVerified() { return [{ type: 'family-link', linkId: 'link-a', familyId: 'family-a',
        personId: 'parent-a', childId: 'child-a', telegramUserId: '55' }] } },
      membership: { async isActiveMember() { return true } },
      renderer: renderEvent,
      delivery: { async send(message) { deliveries.push(message); return { messageId: 42 } } },
      clock: () => new Date(now), workerId: 'delivery-worker', logger: { info() {}, error() {} },
    })
    const pipeline = new SourcePipeline({ source, checkpoints, mode: 'notify', workerId: 'source-worker',
      clock: () => new Date(now), accept: (event) => service.accept(event) })

    await expect(pipeline.process(scope, { origin: 'bootstrap' })).resolves.toMatchObject({ status: 'advanced', events: 0 })
    expect(store.jobs.size).toBe(0)

    currentLesson = lesson('2026-10-17T10:00:00+03:00')
    await expect(pipeline.process(scope)).resolves.toMatchObject({ status: 'advanced', events: 1 })
    expect(store.events.size).toBe(1)
    expect(store.jobs.size).toBe(1)
    await expect(service.runOne()).resolves.toBe(true)
    expect(deliveries).toEqual([{ chatId: '55', text: '📚 Изменения в PETR\n\nУченик\n• Изменено расписание: Математика\n  Математика · 09:00–10:00\n  2026-10-17' }])
    expect([...store.jobs.values()][0]).toMatchObject({ state: 'sent', partReceipts: [{ messageId: 42 }] })
  })
})

class MemoryCheckpoints {
  rows = new Map()
  async acquire({ scopeKey, namespace, ownerBinding, workerId }) {
    const key = `${namespace}:${scopeKey}`
    const row = this.rows.get(key) ?? { sequence: 0, baseline: null, pending: null, version: 0 }
    if (row.leaseToken) return { acquired: false }
    row.leaseToken = `${workerId}-lease`
    row.ownerBinding = structuredClone(ownerBinding)
    this.rows.set(key, row)
    return structuredClone({ ...row, acquired: true, scopeKey, namespace })
  }
  async savePending({ scopeKey, namespace, leaseToken, version, pending }) {
    const row = this.#owned(scopeKey, namespace, leaseToken, version)
    row.pending = structuredClone(pending)
  }
  async advance({ scopeKey, namespace, leaseToken, version, sequence, baseline }) {
    const row = this.#owned(scopeKey, namespace, leaseToken, version)
    row.sequence = sequence
    row.baseline = structuredClone(baseline)
    row.pending = null
    row.version += 1
  }
  async renew({ scopeKey, namespace, leaseToken, version }) { this.#owned(scopeKey, namespace, leaseToken, version) }
  async invalidateOwner({ scopeKey, namespace }) {
    const row = this.rows.get(`${namespace}:${scopeKey}`)
    row.sequence = 0; row.baseline = null; row.pending = null; row.version += 1; row.leaseToken = null
  }
  async release({ scopeKey, namespace, leaseToken }) {
    const row = this.rows.get(`${namespace}:${scopeKey}`)
    if (row?.leaseToken === leaseToken) row.leaseToken = null
  }
  #owned(scopeKey, namespace, leaseToken, version) {
    const row = this.rows.get(`${namespace}:${scopeKey}`)
    if (!row || row.leaseToken !== leaseToken || row.version !== version) throw new Error('checkpoint_stale_lease')
    return row
  }
}
