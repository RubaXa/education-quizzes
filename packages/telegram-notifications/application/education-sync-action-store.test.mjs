import { describe, expect, it } from 'vitest'
import { createFirestoreEducationSyncStore } from './education-sync-dispatcher.mjs'

class FakeDb {
  rows = new Map()
  collection(name) {
    return { doc: (id) => ({ path: `${name}/${id}`, id, get: async () => this.snapshot(`${name}/${id}`) }),
      where: (...args) => this.query(name).where(...args) }
  }
  doc(path) { return { path, id: path.split('/').at(-1), get: async () => this.snapshot(path) } }
  snapshot(path) { const value = this.rows.get(path); return { exists: value !== undefined, data: () => value } }
  query(name) {
    const filters = []; let limit = Infinity
    const query = {
      where(field, op, value) { filters.push([field, op, value]); return query },
      orderBy() { return query }, limit(value) { limit = value; return query },
      startAfter(generation, id) { filters.push(['__after', generation, id]); return query },
      get: async () => {
        let docs = [...this.rows].filter(([path]) => path.startsWith(`${name}/`)).map(([path, value]) => ({ id: path.split('/').at(-1), data: () => value }))
        docs = docs.filter((doc) => filters.every(([field, op, value]) => {
          if (field === '__after') return doc.data().generation > op || (doc.data().generation === op && doc.id > value)
          const actual = doc.data()[field]
          return op === '==' ? actual === value : op === '>' ? actual > value : op === '<=' ? actual <= value : true
        }))
        docs.sort((a, b) => a.data().generation - b.data().generation || a.id.localeCompare(b.id))
        return { docs: docs.slice(0, limit) }
      },
    }
    return query
  }
  async runTransaction(work) {
    const writes = []
    const tx = { get: async (ref) => this.snapshot(ref.path),
      create: (ref, value) => writes.push([ref.path, value]), set: (ref, value) => writes.push([ref.path, value]) }
    const result = await work(tx)
    for (const [path, value] of writes) this.rows.set(path, value)
    return result
  }
}

const event = (id, eventType = 'help.requested') => ({ eventId: id.toString(16).padStart(64, '0'), eventType,
  familyId: 'family-1', childId: 'child-1', source: 'firestore', sourceRef: {
    kind: 'help', documentPath: 'dayHelp/day-1/items/task-1', dayToken: 'day-1', taskId: 'task-1' } })
const artifact = (id) => ({ artifactPath: `operatorSyncTaskArtifacts/${id.toString(16).padStart(64, '0')}`,
  observationPath: `operatorSyncTaskObservations/${id.toString(16).padStart(64, '0')}`, fingerprint: id.toString(16).padStart(64, '0') })
const now = '2026-10-19T10:00:00.000Z'

describe('typed EducationSync action batch', () => {
  it('deduplicates identical event IDs and freezes a request-scoped action range', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    await store.recordAction({ event: event(1), kind: 'triage-help', artifact: artifact(1), now, debounceUntil: now })
    expect(await store.recordAction({ event: event(1), kind: 'triage-help', artifact: artifact(1), now, debounceUntil: now }))
      .toMatchObject({ status: 'duplicate' })
    await store.recordAction({ event: event(2, 'quiz.submitted'), kind: 'review-quiz', artifact: artifact(2), now, debounceUntil: now })
    const claimed = await store.claim({ now, workerId: 'dispatcher-1' })
    expect(claimed).toMatchObject({ actionAfterGeneration: 0, actionThroughGeneration: 2, workKinds: ['action'] })
    await store.markQueued({ requestId: claimed.requestId, workerId: claimed.workerId, now })
    await store.claimRequest({ requestId: claimed.requestId, tokenHash: 'claim-hash', now })
    const firstPage = await store.readActionTasks({ requestId: claimed.requestId, limit: 1 })
    expect(firstPage).toMatchObject({ complete: true, tasks: [{ generation: 1, eventId: event(1).eventId, kind: 'triage-help' }] })
    const secondPage = await store.readActionTasks({ requestId: claimed.requestId, cursor: firstPage.nextCursor, limit: 1 })
    expect(secondPage).toMatchObject({ complete: true, nextCursor: null, tasks: [{ generation: 2, eventId: event(2).eventId, kind: 'review-quiz' }] })
    expect(await store.completeClaim({ requestId: claimed.requestId, tokenHash: 'claim-hash', now })).toEqual({ status: 'incomplete_actions' })
    for (const task of [...firstPage.tasks, ...secondPage.tasks]) db.rows.get(`operatorSyncJobs/${task.jobId}`).status = 'done'
    expect(await store.completeClaim({ requestId: claimed.requestId, tokenHash: 'claim-hash', now })).toEqual({ status: 'completed' })
    await expect(store.readActionTasks({ requestId: 'other-request', limit: 1 })).rejects.toThrow('education_sync_action_request_unclaimed')
  })

  it('does not widen an already frozen batch with events arriving during the run', async () => {
    const db = new FakeDb()
    const store = createFirestoreEducationSyncStore(db)
    await store.recordAction({ event: event(3), kind: 'triage-help', artifact: artifact(3), now, debounceUntil: now })
    const claimed = await store.claim({ now, workerId: 'dispatcher-1' })
    await store.markQueued({ requestId: claimed.requestId, workerId: claimed.workerId, now })
    await store.claimRequest({ requestId: claimed.requestId, tokenHash: 'claim-hash', now })
    await store.recordAction({ event: event(4), kind: 'triage-help', artifact: artifact(4), now, debounceUntil: now })
    const tasks = await store.readActionTasks({ requestId: claimed.requestId, limit: 10 })
    expect(tasks.tasks.map((task) => task.eventId)).toEqual([event(3).eventId])
  })
})
