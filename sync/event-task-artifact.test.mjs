import { describe, expect, it } from 'vitest'
import { captureEventTaskInputs, prepareEventTaskArtifact, validateTaskArtifact } from './event-task-artifact.mjs'
import { legacyHelpOperationId } from './legacy-help-identity.mjs'
import { mergeFamilyAssignments } from '../day/family-assignment.mjs'

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
  it('dispatches an olympiad source sheet as conditions, not a learner solution', async () => {
    const { db, rows } = fixture({ 'dayPages/day': { kind: 'student', date: '2026-10-19', targetDate: '2026-10-20', planRevision: 2, subjects: [{ name: 'Математика', tasks: [{ id: 'task', optional: true, learningContext: { kind: 'olympiad', id: 'o1' }, sourceIntake: { kind: 'olympiad-sheet' } }] }] } })
    const result = await prepareEventTaskArtifact(db, event)
    const artifact = rows.get(result.artifactPath)
    expect(artifact.inputs.route.next).toBe('ingest-olympiad-sheet')
    expect(artifact.instruction).toContain('не решение ученика')
    expect(artifact.inputs.route.steps).toContain('publish-family-tasks-and-readback')
  })
  it('routes a stored photo after projecting the same family intake to both roles', async () => {
    const task = { id: 'task', familyId: 'family', childId: 'child', sourceSystem: 'family', sourceId: 'task', sourceRevision: 1, dayProjectionVersion: 1, subjectId: 'math', subjectName: 'Математика', dueDate: '2026-10-20', title: 'Свои задачи', originalText: 'Сфотографируй условия', publication: 'active', evidence: 'photo', materialIds: [], steps: ['Выбери лист'], submission: { buttonLabel: 'Добавить', lead: 'Фото условий', photo: 'Лист целиком' }, optional: true, learningContext: { kind: 'olympiad', id: 'o1' }, sourceIntake: { kind: 'olympiad-sheet' } }
    const base = { date: '2026-10-19', targetDate: '2026-10-20', planRevision: 1, subjects: [] }
    const student = mergeFamilyAssignments({ ...base, kind: 'student' }, [task])
    const parent = mergeFamilyAssignments({ ...base, kind: 'parent' }, [task])
    expect(student.subjects[0].tasks[0].sourceIntake).toEqual(parent.subjects[0].tasks[0].sourceIntake)
    const { db } = fixture({ 'dayPages/day': student })
    const inputs = await captureEventTaskInputs(db, event)
    expect(inputs.route.next).toBe('ingest-olympiad-sheet')
    expect(inputs.context.task.id).toBe(task.id)
    expect(inputs.source.storage.sha256).toBe('b'.repeat(64))
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

  it('captures only selected confirmed photos from the exact task and strips transport credentials', async () => {
    const id = 'upload-request-1234567890'
    const helpEvent = { ...event, eventType: 'help.requested', sourceRef: { kind: 'help', documentPath: 'dayHelp/day/items/task', dayToken: 'day', taskId: 'task' } }
    const row = { taskId: 'task', status: 'pending', upload: { href: 'private-secret' }, storage: { state: 'stored', path: 'app:/private/photo', sha256: 'b'.repeat(64) } }
    const { db, rows } = fixture({ 'dayHelp/day/items/task': { taskId: 'task', revision: 1, planRevision: 2, photoUploadIds: [id] }, [`dayUploads/day/files/${id}`]: row })
    const result = await captureEventTaskInputs(db, helpEvent)
    expect(result.photos).toMatchObject([{ id, taskId: 'task' }])
    expect(JSON.stringify(result)).not.toContain('private-secret')
    rows.set(`dayUploads/day/files/${id}`, { ...row, taskId: 'other' })
    await expect(captureEventTaskInputs(db, helpEvent)).rejects.toThrow('task_help_photo_not_reviewable')
  })

  it('captures more than one read batch without restricting the number of task photos', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `upload-request-${String(i).padStart(10, '0')}`)
    const rows = Object.fromEntries(ids.map(id => [`dayUploads/day/files/${id}`, { taskId: 'task', status: 'pending', storage: { state: 'stored', path: 'app:/private/photo', sha256: 'b'.repeat(64) } }]))
    const helpEvent = { ...event, eventType: 'help.requested', sourceRef: { kind: 'help', documentPath: 'dayHelp/day/items/task', dayToken: 'day', taskId: 'task' } }
    const { db } = fixture({ ...rows, 'dayHelp/day/items/task': { taskId: 'task', revision: 1, planRevision: 2, photoUploadIds: ids } })
    expect((await captureEventTaskInputs(db, helpEvent)).photos.map(photo => photo.id)).toEqual(ids)
  })

  it('reads the original photo request when the current projection advances', async () => {
    const id = 'upload-request-1234567890'
    const helpEvent = { ...event, eventType: 'help.requested', sourceRef: { kind: 'help', documentPath: 'dayHelp/day/items/task', dayToken: 'day', taskId: 'task' } }
    const { db } = fixture({ 'dayHelp/day/items/task': { taskId: 'task', revision: 2, eventReceiptId: 'c'.repeat(64) },
      [`dayHelp/day/items/task/requests/${event.eventId}`]: { taskId: 'task', revision: 1, eventReceiptId: event.eventId, planRevision: 2, photoUploadIds: [id] },
      [`dayUploads/day/files/${id}`]: { taskId: 'task', status: 'pending', storage: { state: 'stored', path: 'app:/private/photo', sha256: 'b'.repeat(64) } } })
    await expect(captureEventTaskInputs(db, helpEvent)).resolves.toMatchObject({ source: { revision: 1 }, photos: [{ id }] })
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
