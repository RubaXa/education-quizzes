/** @see ../docs/modules/synchronization/event-queue.md#upload-lifecycle */
import { describe, expect, it } from 'vitest'
import { createEducationEventId } from '../packages/education-events/envelope.mjs'
import { createUploadBrokerHandlers } from '../packages/education-runtime/upload-broker.mjs'
import { createFirestoreEducationSyncStore } from '../packages/telegram-notifications/application/education-sync-dispatcher.mjs'
import { prepareEventTaskArtifact } from './event-task-artifact.mjs'
import { syncJobId } from './job-queue.mjs'
import { withdrawUploadWork } from './upload-lifecycle.mjs'

const now = '2026-10-30T10:00:00.000Z'
const event = { eventId: 'a'.repeat(64), eventType: 'upload.confirmed', source: 'firestore', familyId: 'family', childId: 'child',
  operationId: 'upload-confirmed:file', actor: { type: 'system', id: 'server' },
  sourceRef: { kind: 'upload', dayToken: 'day', recordId: 'file', taskId: 'task', documentPath: 'dayUploads/day/files/file' } }
const deletion = { ...event, eventId: 'd'.repeat(64), eventType: 'upload.delete_requested', operationId: 'upload-delete:file' }
function fixture() {
  const rows = new Map(), writes = []
  const snap = path => ({ exists: rows.has(path), data: () => structuredClone(rows.get(path)), ref: db.doc(path), id: path.split('/').at(-1) })
  const db = {
    doc(path) { return { path, id: path.split('/').at(-1), get: async () => snap(path), delete: async () => rows.delete(path) } },
    collection(name) {
      const filters = []
      const q = { doc: id => db.doc(`${name}/${id}`), where(field, op, value) { filters.push([field, value]); return q },
        get: async () => ({ docs: [...rows.keys()].filter(path => path.startsWith(`${name}/`) && path.split('/').length === name.split('/').length + 1)
          .filter(path => filters.every(([key, value]) => key.split('.').reduce((row, part) => row?.[part], rows.get(path)) === value)).map(snap) }) }
      return q
    },
    async runTransaction(fn) {
      const staged = []; let written = false
      const tx = { get: async ref => { if (written) throw Error('read after write'); return ref.get() },
        set(ref, value) { written = true; staged.push([ref.path, value]) },
        create(ref, value) { written = true; staged.push([ref.path, value]) },
        update(ref, patch) { written = true; staged.push([ref.path, { ...rows.get(ref.path), ...patch }]) } }
      const result = await fn(tx)
      for (const [path, value] of staged) { rows.set(path, value); writes.push(path) }
      return result
    },
  }
  rows.set('families/family', { active: true })
  rows.set('families/family/children/child', { displayName: 'Learner' })
  rows.set('dayOwners/day', { familyId: 'family', childId: 'child', date: '2026-10-29' })
  const request = { id: 'request-page', state: 'open', question: 'Пришли страницу с правилом.', photoPrompt: 'Вся страница с номером.' }
  rows.set('dayPages/day', { kind: 'student', date: '2026-10-29', targetDate: '2026-10-30', planRevision: 2,
    subjects: [{ name: 'Английский язык', tasks: [{ id: 'task', materialRequest: request, assessmentIntent: { state: 'needs-topic' } }] }] })
  rows.set(event.sourceRef.documentPath, { taskId: 'task', purpose: 'source-material', status: 'pending', planRevision: 2,
    storage: { state: 'stored', path: 'app:/private/page.jpg', sha256: 'b'.repeat(64) } })
  const waits = ['classify-assignment', 'enrich-task'].map(kind => syncJobId(kind, 'family', 'child', '2026-10-30:task'))
  waits.forEach((id, index) => rows.set(`operatorSyncJobs/${id}`, { kind: index ? 'enrich-task' : 'classify-assignment',
    familyId: 'family', childId: 'child', source: { dayToken: 'day', taskId: 'task' },
    status: 'blocked', reason: 'awaiting-student-material', fingerprint: 'c'.repeat(64) }))
  return { db, rows, writes, waits }
}

describe('upload lifecycle and source wait continuation', () => {
  it('closes queued, processing and blocked upload work on deletion, preserves sibling and foreign jobs, and safely replays', async () => {
    const { db, rows } = fixture()
    rows.get(event.sourceRef.documentPath).status = 'deleted'
    for (const [id, status] of [['one', 'queued'], ['two', 'processing'], ['three', 'blocked'], ['done', 'done']]) {
      rows.set(`operatorSyncJobs/${id}`, { familyId: 'family', childId: 'child', kind: 'review-work', sourceRef: event.sourceRef, status })
    }
    rows.set('operatorSyncJobs/sibling', { familyId: 'family', childId: 'child', kind: 'review-work', sourceRef: { documentPath: 'dayUploads/day/files/other' }, status: 'queued' })
    rows.set('operatorSyncJobs/foreign', { familyId: 'family', childId: 'other-child', kind: 'review-work', sourceRef: event.sourceRef, status: 'queued' })
    expect(await withdrawUploadWork(db, deletion)).toEqual({ withdrawn: 3 })
    expect(await withdrawUploadWork(db, deletion)).toEqual({ withdrawn: 0 })
    expect(rows.get('operatorSyncJobs/one')).toMatchObject({ status: 'done', phase: 'source-withdrawn', evidence: `educationEvents/${deletion.eventId}` })
    expect(rows.get('operatorSyncJobs/sibling').status).toBe('queued')
    expect(rows.get('operatorSyncJobs/foreign').status).toBe('queued')
    expect(rows.get(`operatorSyncJobs/${syncJobId('enrich-task', 'family', 'child', '2026-10-30:task')}`).status).toBe('blocked')
  })

  it('runs cancellation in the broker before grace-period retry and does not cancel a live source or another owner', async () => {
    const { db, rows } = fixture()
    const token = 'dayabcdefghijklmnopqrstuv', id = 'fileabcdefghijklmnopqrstuv'
    const sourceRef = { ...event.sourceRef, dayToken: token, recordId: id, documentPath: `dayUploads/${token}/files/${id}` }
    const remove = { ...deletion, familyId: 'familyabcdefghijklmnop', childId: 'childabcdefghijklmnopq', sourceRef }, path = sourceRef.documentPath
    rows.set(`dayOwners/${token}`, { ...rows.get('dayOwners/day'), familyId: remove.familyId, childId: remove.childId })
    rows.set(`dayPages/${token}`, rows.get('dayPages/day'))
    rows.set(path, { ...rows.get(event.sourceRef.documentPath), contentType: 'image/jpeg' })
    rows.set('operatorSyncJobs/review', { familyId: remove.familyId, childId: remove.childId, kind: 'review-work', sourceRef, status: 'queued' })
    expect(await withdrawUploadWork(db, remove)).toEqual({ withdrawn: 0 })
    rows.set(path, { ...rows.get(path), status: 'deleted', sha256: 'b'.repeat(64), deletedAt: now })
    const handlers = createUploadBrokerHandlers({ db, disk: { head: async () => null }, clock: () => Date.parse(now) })
    await expect(handlers['upload.delete_requested'](remove)).rejects.toMatchObject({ safeCode: 'upload_delete_grace_period' })
    expect(rows.get('operatorSyncJobs/review').phase).toBe('source-withdrawn')
    await expect(withdrawUploadWork(db, { ...deletion, childId: 'another' })).rejects.toThrow('owner_changed')
  })

  it('does not resurrect a review when confirmation arrives after deletion or physical cleanup', async () => {
    const { db, rows } = fixture()
    const store = createFirestoreEducationSyncStore(db)
    const artifact = { artifactPath: `operatorSyncTaskArtifacts/${'b'.repeat(64)}`, fingerprint: 'c'.repeat(64) }
    rows.get(event.sourceRef.documentPath).status = 'deleted'
    expect(await store.recordAction({ event, kind: 'review-work', artifact, now, debounceUntil: now })).toEqual({ status: 'completed' })
    rows.delete(event.sourceRef.documentPath)
    const id = await createEducationEventId(deletion)
    rows.set(`educationEvents/${id}`, deletion)
    expect(await store.recordAction({ event, kind: 'review-work', artifact, now, debounceUntil: now })).toEqual({ status: 'completed' })
    expect(rows.has('educationSyncDispatch/current')).toBe(false)
  })

  it('captures a requested page and atomically resumes exact waiting jobs with one autonomous dispatch generation', async () => {
    const { db, rows, waits } = fixture()
    const artifact = await prepareEventTaskArtifact(db, event, { now })
    const captured = rows.get(artifact.artifactPath)
    expect(captured.inputs.route.next).toBe('review-source-material')
    expect(captured.inputs.waitingJobs.map(wait => wait.id)).toEqual(waits)
    expect(captured.instruction).toContain('Не оставляй их в processing')
    const store = createFirestoreEducationSyncStore(db)
    const input = { event, kind: 'review-work', artifact, waitingJobs: artifact.waitingJobs, now, debounceUntil: now }
    expect(await store.recordAction(input)).toMatchObject({ status: 'accepted', generation: 1, nextDueAt: now })
    for (const id of waits) expect(rows.get(`operatorSyncJobs/${id}`)).toMatchObject({ status: 'processing', phase: 'source-material-received', materialRequestId: 'request-page', resumedByEventId: event.eventId })
    const refreshed = await prepareEventTaskArtifact(db, event, { now })
    expect(refreshed.artifactPath).toBe(artifact.artifactPath) // claiming must not invalidate its own frozen inputs
    expect(await store.recordAction(input)).toMatchObject({ status: 'duplicate', generation: 1 })
    expect(await store.claim({ now, workerId: 'worker' })).toMatchObject({ workKinds: ['action'], generation: 1 })
    expect(rows.get(event.sourceRef.documentPath).status).toBe('pending') // receiving a page is not a grade
  })

  it('returns dependent stages to the same request when its photo is deleted before analysis', async () => {
    const { db, rows, waits } = fixture()
    const confirmed = { ...event, eventId: await createEducationEventId(event) }
    const artifact = await prepareEventTaskArtifact(db, confirmed, { now })
    const store = createFirestoreEducationSyncStore(db)
    await store.recordAction({ event: confirmed, kind: 'review-work', artifact, waitingJobs: artifact.waitingJobs, now, debounceUntil: now })
    rows.get(event.sourceRef.documentPath).status = 'deleted'
    await withdrawUploadWork(db, deletion)
    for (const id of waits) expect(rows.get(`operatorSyncJobs/${id}`)).toMatchObject({ status: 'blocked', phase: 'awaiting-student-material', resumedByEventId: null })
    expect(rows.get('dayPages/day').subjects[0].tasks[0].materialRequest.state).toBe('open')
  })

  it('continues requested pages independently of an unrelated Mesh block', async () => {
    const { db, rows, waits } = fixture()
    rows.set('educationSyncDispatch/current', { status: 'blocked', requestId: 'mesh-block', generation: 10,
      sendingGeneration: 10, sourceAttemptGeneration: 10, sendingKinds: ['mesh'], blockedReasonCode: 'source_unavailable',
      completedActionGeneration: 10, debounceUntil: now })
    const artifact = await prepareEventTaskArtifact(db, event, { now })
    const store = createFirestoreEducationSyncStore(db)
    await store.recordAction({ event, kind: 'review-work', artifact, waitingJobs: artifact.waitingJobs, now, debounceUntil: now })
    const claimed = await store.claim({ now, workerId: 'automatic-worker' })
    expect(claimed).not.toBeNull()
    expect(claimed.workKinds).toContain('action')
    expect(rows.get(`operatorSyncJobs/${waits[0]}`).phase).toBe('source-material-received')
    expect(rows.get('educationSyncDispatch/current').lastSourceBlock ?? rows.get('educationSyncDispatch/current').blockedReasonCode).toBeTruthy()
  })

  it('does not resume an obsolete request or changed job revision', async () => {
    const { db, rows, waits } = fixture()
    const artifact = await prepareEventTaskArtifact(db, event, { now })
    rows.get(`operatorSyncJobs/${waits[0]}`).fingerprint = 'e'.repeat(64)
    rows.get('dayPages/day').subjects[0].tasks[0].materialRequest.id = 'replacement-request'
    const store = createFirestoreEducationSyncStore(db)
    await store.recordAction({ event, kind: 'review-work', artifact, waitingJobs: artifact.waitingJobs, now, debounceUntil: now })
    for (const id of waits) expect(rows.get(`operatorSyncJobs/${id}`).status).toBe('blocked')
  })
})
