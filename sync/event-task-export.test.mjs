import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareEventTaskArtifact } from './event-task-artifact.mjs'
import { exportEventTaskManifest } from './event-task-export.mjs'

const now = '2026-10-19T10:00:00.000Z'
const roots = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'education-task-export-')); roots.push(root)
  const rows = new Map(Object.entries({
    'assignments/quiz': { familyId: 'f', childId: 'c', status: 'submitted', questions: [{ id: 'q', prompt: '2+2?' }], answers: { q: '4' } },
    'families/f/children/c': { displayName: 'Ученик' }, 'answerKeys/quiz': { entries: { q: { correct: '4' } } },
    'families/f': { active: true },
  }))
  const get = (path) => ({ exists: rows.has(path), data: () => structuredClone(rows.get(path)) })
  const db = { doc: (path) => ({ path, get: vi.fn(async () => get(path)) }), runTransaction: async (fn) => fn({
    get: async (ref) => get(ref.path), create: (ref, value) => rows.set(ref.path, value), set: (ref, value) => rows.set(ref.path, value),
    update: (ref, value) => rows.set(ref.path, { ...rows.get(ref.path), ...value }),
  }) }
  const event = { eventId: 'a'.repeat(64), eventType: 'quiz.submitted', source: 'firestore', familyId: 'f', childId: 'c',
    operationId: 'quiz-submit:quiz', sourceRef: { kind: 'quiz', documentPath: 'assignments/quiz', quizToken: 'quiz' } }
  const artifact = await prepareEventTaskArtifact(db, event, { now })
  const jobId = 'b'.repeat(64)
  rows.set(`operatorSyncJobs/${jobId}`, { familyId: 'f', childId: 'c', status: 'queued' })
  const task = { eventId: event.eventId, jobId, artifactPath: artifact.artifactPath, kind: 'review-quiz', generation: 3 }
  const state = { requestId: 'request', status: 'running', claimTokenHash: 'secret-hash', workflowLeaseUntil: '2026-10-19T10:10:00.000Z',
    actionAfterGeneration: 2, actionThroughGeneration: 3 }
  const store = { read: vi.fn(async () => state), readActionTasks: vi.fn(async () => ({ tasks: [task], complete: true, nextCursor: null })) }
  return { root, db, rows, store, state, task, options: { root, requestId: 'request', tokenHash: 'secret-hash', now } }
}

describe('request scoped task export', () => {
  it('exports private captured inputs and only a safe path/count summary', async () => {
    const { db, store, options } = await fixture()
    const result = await exportEventTaskManifest(db, store, options)
    expect(result.status).toBe('ready')
    expect(result.taskCount).toBe(1)
    expect(JSON.stringify(result)).not.toContain('2+2')
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'))
    const pagePath = join(result.manifestPath, '..', manifest.pages[0].name)
    const page = JSON.parse(readFileSync(pagePath, 'utf8'))
    expect(page.tasks[0].artifact.inputs.source.answers.q).toBe('4')
    expect(statSync(pagePath).mode & 0o777).toBe(0o600)
    expect(store.readActionTasks).toHaveBeenCalledExactlyOnceWith({ requestId: 'request', cursor: null, limit: 100 })
  })

  it('rejects a foreign or expired claim before reading tasks', async () => {
    const { db, store, options } = await fixture()
    await expect(exportEventTaskManifest(db, store, { ...options, tokenHash: 'wrong' })).rejects.toThrow('claim_file_invalid')
    expect(store.readActionTasks).not.toHaveBeenCalled()
  })

  it('does not label a missing artifact as no-work', async () => {
    const { db, rows, store, options, task } = await fixture()
    rows.delete(task.artifactPath)
    await expect(exportEventTaskManifest(db, store, options)).rejects.toThrow('task_manifest_incomplete')
  })

  it('paginates the frozen range and skips jobs already completed', async () => {
    const { db, rows, store, options, task } = await fixture()
    rows.get(`operatorSyncJobs/${task.jobId}`).status = 'done'
    store.readActionTasks.mockResolvedValueOnce({ tasks: [task], complete: true, nextCursor: 'cursor' })
      .mockResolvedValueOnce({ tasks: [], complete: true, nextCursor: null })
    const result = await exportEventTaskManifest(db, store, options)
    expect(result).toMatchObject({ status: 'no-work', taskCount: 0, doneCount: 1 })
    expect(store.readActionTasks).toHaveBeenLastCalledWith({ requestId: 'request', cursor: 'cursor', limit: 100 })
  })

  it('rejects repeated cursors rather than spinning forever', async () => {
    const { db, store, options } = await fixture()
    store.readActionTasks.mockResolvedValue({ tasks: [], complete: true, nextCursor: 'repeat' })
    await expect(exportEventTaskManifest(db, store, options)).rejects.toThrow('task_manifest_cursor_invalid')
  })

  it('refreshes a changed stale exact source into a new immutable revision of the same queued job', async () => {
    const { db, rows, store, options, task } = await fixture()
    rows.get('assignments/quiz').questions[0].prompt = 'Уточнённое условие'
    const result = await exportEventTaskManifest(db, store, { ...options, now: '2026-10-19T10:06:00.000Z' })
    expect(result.status).toBe('ready')
    const updatedJob = rows.get(`operatorSyncJobs/${task.jobId}`)
    expect(updatedJob.artifactPath).not.toBe(task.artifactPath)
    expect(updatedJob.artifactRevision).toBe(2)
    expect(rows.get(task.artifactPath).inputs.source.questions[0].prompt).toBe('2+2?')
    expect(rows.get(updatedJob.artifactPath).inputs.source.questions[0].prompt).toBe('Уточнённое условие')
    expect([...rows.keys()].some((path) => path.includes('/artifactRevisions/'))).toBe(true)
  })
})
