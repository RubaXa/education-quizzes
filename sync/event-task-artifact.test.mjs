import { describe, expect, it } from 'vitest'
import { captureEventTaskInputs, prepareEventTaskArtifact, validateTaskArtifact } from './event-task-artifact.mjs'
import { legacyHelpOperationId } from './legacy-help-identity.mjs'

const event = { eventId: 'a'.repeat(64), eventType: 'upload.confirmed', source: 'firestore',
  familyId: 'family', childId: 'child', operationId: 'upload-confirmed:file:hash',
  sourceRef: { kind: 'upload', documentPath: 'dayUploads/day/files/file', dayToken: 'day', recordId: 'file', taskId: 'task' } }
function fixture(overrides = {}) {
  const rows = new Map(Object.entries({
    'dayUploads/day/files/file': { taskId: 'task', status: 'pending', storage: { state: 'stored', path: 'app:/private/work.jpg', sha256: 'b'.repeat(64) } },
    'families/family/children/child': { displayName: 'Ученик' },
    'families/family': { active: true },
    'dayOwners/day': { familyId: 'family', childId: 'child', date: '2026-10-19' },
    'dayPages/day': { kind: 'student', date: '2026-10-19', targetDate: '2026-10-20', planRevision: 2,
      subjects: [{ name: 'Математика', tasks: [{ id: 'task', title: 'Уравнение', meshText: 'Решить 3x + 7 = 22', problems: [] }] }] },
    ...overrides,
  }))
  const reads = []
  const snapshot = (path) => ({ exists: rows.has(path), data: () => structuredClone(rows.get(path)) })
  const db = { doc: (path) => ({ path, get: async () => { reads.push(path); return snapshot(path) } }),
    runTransaction: async (fn) => fn({ get: async (ref) => snapshot(ref.path), create: (ref, value) => rows.set(ref.path, structuredClone(value)), set: (ref, value) => rows.set(ref.path, structuredClone(value)) }) }
  return { db, rows, reads }
}

describe('closed event task inputs', () => {
  it('dispatches a page requested from the student as source analysis without grading the homework', async () => {
    const { db, rows } = fixture({
      'dayUploads/day/files/file': { taskId: 'task', purpose: 'source-material', status: 'pending',
        storage: { state: 'stored', path: 'app:/private/page.jpg', sha256: 'b'.repeat(64) } },
    })
    const result = await prepareEventTaskArtifact(db, event)
    const artifact = rows.get(result.artifactPath)
    expect(artifact.inputs.route.next).toBe('review-source-material')
    expect(artifact.instruction).toContain('sourceAnalysis')
    expect(artifact.instruction).toContain('не оценивать выполнение ДЗ')
    expect(validateTaskArtifact(artifact, { eventId: event.eventId }).state).toBe('ready')
  })
  it('captures the exact work, assignment and owner without any collection scan', async () => {
    const { db, rows, reads } = fixture()
    const result = await prepareEventTaskArtifact(db, event, { now: '2026-10-19T10:00:00.000Z' })
    expect(reads).toEqual(['dayUploads/day/files/file', 'families/family', 'families/family/children/child', 'dayOwners/day', 'dayPages/day'])
    const artifact = rows.get(result.artifactPath)
    expect(artifact.inputs.context.task.meshText).toBe('Решить 3x + 7 = 22')
    expect(artifact.inputs.source.storage.sha256).toBe('b'.repeat(64))
    expect(validateTaskArtifact(artifact, { eventId: event.eventId, now: '2026-10-19T10:01:00.000Z' }).state).toBe('ready')
    const again = await prepareEventTaskArtifact(db, event, { now: '2026-10-19T10:02:00.000Z' })
    expect(again.artifactId).toBe(result.artifactId)
    expect(rows.get(result.artifactPath).verifiedAt).toBe('2026-10-19T10:00:00.000Z')
  })

  it.each([
    ['foreign owner', { 'dayOwners/day': { familyId: 'other', childId: 'child', date: '2026-10-19' } }, 'task_owner_mismatch'],
    ['missing context', { 'dayPages/day': { kind: 'student', date: '2026-10-19', subjects: [] } }, 'task_context_missing'],
    ['unconfirmed file', { 'dayUploads/day/files/file': { taskId: 'task', status: 'uploaded' } }, 'task_source_not_reviewable'],
  ])('blocks %s instead of producing an empty task', async (_, overrides, code) => {
    await expect(captureEventTaskInputs(fixture(overrides).db, event)).rejects.toThrow(code)
  })

  it('rejects a forged source path before any read', async () => {
    const { db, reads } = fixture()
    await expect(captureEventTaskInputs(db, { ...event, sourceRef: { ...event.sourceRef, documentPath: 'secrets/token' } })).rejects.toThrow('task_source_path_invalid')
    expect(reads).toEqual([])
  })

  it('refuses a request after its initiating member loses access', async () => {
    const { db } = fixture({ 'deviceSessions/user': { linkToken: 'personal-link' },
      'accessLinks/personal-link': { active: true, personId: 'parent' },
      'families/family/members/parent': { active: false, role: 'parent', childIds: ['child'] } })
    await expect(captureEventTaskInputs(db, { ...event, actor: { type: 'user', uid: 'user' } })).rejects.toThrow('task_actor_unavailable')
  })

  it('does not process an old help revision as the latest request', async () => {
    const { db } = fixture({ 'dayHelp/day/items/task': { taskId: 'task', revision: 2, requestText: 'Новый запрос', eventReceiptId: 'c'.repeat(64) } })
    await expect(captureEventTaskInputs(db, { ...event, eventType: 'help.requested', operationId: 'help:task:1',
      sourceRef: { kind: 'help', documentPath: 'dayHelp/day/items/task', dayToken: 'day', taskId: 'task' } })).rejects.toThrow('task_source_superseded')
  })

  it('accepts only the exact current legacy request when an old PWA retained a stale queue receipt', async () => {
    const requestedAt = '2026-10-19T10:00:00.000Z'
    const { db } = fixture({ 'dayHelp/day/items/task': { taskId: 'task', revision: 2, requestText: '', requestedAt, eventReceiptId: 'c'.repeat(64) } })
    const legacyEvent = { ...event, eventType: 'help.requested', actor: { type: 'system', id: 'server' },
      operationId: legacyHelpOperationId({ dayToken: 'day', taskId: 'task', revision: 2, requestedAtMs: Date.parse(requestedAt) }),
      sourceRef: { kind: 'help', documentPath: 'dayHelp/day/items/task', dayToken: 'day', taskId: 'task' } }
    await expect(captureEventTaskInputs(db, legacyEvent)).resolves.toMatchObject({ source: { requestText: '', revision: 2 } })
    await expect(captureEventTaskInputs(db, { ...legacyEvent, operationId: legacyHelpOperationId({
      dayToken: 'day', taskId: 'task', revision: 1, requestedAtMs: Date.parse(requestedAt) }) })).rejects.toThrow('task_source_superseded')
  })

  it('detects expired, future-dated and tampered inputs deterministically', async () => {
    const { db, rows } = fixture()
    const result = await prepareEventTaskArtifact(db, event, { now: '2026-10-19T10:00:00.000Z' })
    const artifact = rows.get(result.artifactPath)
    expect(validateTaskArtifact(artifact, { eventId: event.eventId, now: '2026-10-19T10:06:00.000Z' }).state).toBe('stale')
    expect(validateTaskArtifact(artifact, { eventId: event.eventId, now: '2026-10-19T09:59:00.000Z' }).state).toBe('stale')
    artifact.inputs.context.task.meshText = 'Другое условие'
    expect(() => validateTaskArtifact(artifact, { eventId: event.eventId, now: '2026-10-19T10:01:00.000Z' })).toThrow('task_artifact_invalid')
  })
})
