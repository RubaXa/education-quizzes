import { describe, expect, it } from 'vitest'
import { prepareEventTaskArtifact } from './event-task-artifact.mjs'
import { syncJobId } from './job-queue.mjs'
import { publishHelpResponse } from './help-response.mjs'

const eventId = 'a'.repeat(64), photo = 'upload-request-1234567890', now = '2026-10-28T10:00:00.000Z'
const event = { eventId, eventType: 'help.requested', source: 'firestore', familyId: 'family', childId: 'child', operationId: 'op', actor: { type: 'system', id: 'server' }, sourceRef: { kind: 'help', documentPath: 'dayHelp/day/items/task', dayToken: 'day', taskId: 'task' } }
function fixture() {
  const rows = new Map(Object.entries({
    [`educationEvents/${eventId}`]: event,
    'dayHelp/day/items/task': { taskId: 'task', revision: 1, planRevision: 2, eventReceiptId: eventId, photoUploadIds: [photo] },
    [`dayHelp/day/items/task/requests/${eventId}`]: { taskId: 'task', revision: 1, planRevision: 2, eventReceiptId: eventId, photoUploadIds: [photo] },
    [`dayUploads/day/files/${photo}`]: { taskId: 'task', status: 'pending', storage: { state: 'stored', path: 'app:/private/work.jpg', sha256: 'b'.repeat(64) } },
    'families/family': { active: true }, 'families/family/children/child': { displayName: 'Ученик' },
    'dayOwners/day': { familyId: 'family', childId: 'child', date: '2026-10-28' },
    'dayPages/day': { kind: 'student', date: '2026-10-28', planRevision: 2, subjects: [{ name: 'Математика', tasks: [{ id: 'task', title: 'Задача' }] }] },
  }))
  const snapshot = path => ({ exists: rows.has(path), data: () => structuredClone(rows.get(path)) })
  const db = { doc: path => ({ path, get: async () => snapshot(path) }), runTransaction: async fn => fn({ get: async ref => snapshot(ref.path),
    create: (ref, value) => { if (rows.has(ref.path)) throw new Error('already-exists'); rows.set(ref.path, structuredClone(value)) },
    set: (ref, value) => rows.set(ref.path, structuredClone(value)), update: (ref, value) => rows.set(ref.path, { ...rows.get(ref.path), ...structuredClone(value) }) }) }
  return { db, rows }
}

describe('shared help response', () => {
  it('publishes the response for the original event after a later addition, and retries idempotently', async () => {
    const { db, rows } = fixture()
    const artifact = await prepareEventTaskArtifact(db, event, { now })
    rows.set(`operatorSyncJobs/${syncJobId('triage-help', 'family', 'child', eventId)}`, { kind: 'triage-help', familyId: 'family', childId: 'child', eventId, sourceId: eventId, status: 'queued', artifactPath: artifact.artifactPath, fingerprint: artifact.fingerprint })
    const nextEventId = 'c'.repeat(64), nextJobId = syncJobId('triage-help', 'family', 'child', nextEventId)
    rows.set(`operatorSyncJobs/${nextJobId}`, { status: 'queued', eventId: nextEventId })
    rows.set('dayHelp/day/items/task', { taskId: 'task', revision: 2, planRevision: 2, eventReceiptId: 'c'.repeat(64), photoUploadIds: [photo] })
    const args = { eventId, artifactId: artifact.artifactId, text: 'Проверь сумму.', now }
    expect(await publishHelpResponse(db, args)).toMatchObject({ verified: true, unchanged: false })
    expect(rows.get(`dayGuidance/day/items/help-${eventId}`)).toMatchObject({ sourceRequestEventId: eventId, sourceArtifactId: artifact.artifactId, sourcePlanRevision: 2 })
    expect(await publishHelpResponse(db, { ...args, now: '2026-10-28T11:00:00.000Z' })).toMatchObject({ verified: true, unchanged: true })
    await expect(publishHelpResponse(db, { ...args, text: 'Другая подсказка.' })).rejects.toThrow('help_response_conflict')
    expect(rows.get('dayHelp/day/items/task').eventReceiptId).toBe('c'.repeat(64))
    expect(rows.get(`operatorSyncJobs/${nextJobId}`).status).toBe('queued')
    expect(rows.get(`operatorSyncJobs/${syncJobId('triage-help', 'family', 'child', eventId)}`)).toMatchObject({ status: 'done', evidence: `dayGuidance/day/items/help-${eventId}` })
  })
  it('blocks a changed plan, evidence, identity, and expired artifact', async () => {
    for (const changed of ['plan', 'photo', 'owner', 'expired', 'job']) {
      const { db, rows } = fixture(), artifact = await prepareEventTaskArtifact(db, event, { now })
      rows.set(`operatorSyncJobs/${syncJobId('triage-help', 'family', 'child', eventId)}`, { kind: 'triage-help', familyId: 'family', childId: 'child', eventId, sourceId: eventId, status: 'queued', artifactPath: artifact.artifactPath, fingerprint: artifact.fingerprint })
      if (changed === 'job') rows.get(`operatorSyncJobs/${syncJobId('triage-help', 'family', 'child', eventId)}`).fingerprint = 'd'.repeat(64)
      if (changed === 'plan') rows.get('dayPages/day').planRevision = 3
      if (changed === 'photo') rows.get(`dayUploads/day/files/${photo}`).storage.sha256 = 'c'.repeat(64)
      if (changed === 'owner') rows.get('dayOwners/day').childId = 'other'
      await expect(publishHelpResponse(db, { eventId, artifactId: artifact.artifactId, text: 'Ответ', now: changed === 'expired' ? '2026-10-28T10:10:00.000Z' : now })).rejects.toThrow()
      expect(rows.has(`dayGuidance/day/items/help-${eventId}`)).toBe(false)
    }
  })
})
