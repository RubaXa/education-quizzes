import { describe, expect, it } from 'vitest'
import { photoPlacementPatch, relocateReviewedPhoto } from './photo-placement.mjs'

const photo = { taskId: 'task-a', planRevision: 3, status: 'reviewed', storage: { state: 'stored', sha256: 'original' }, coveredTaskIds: ['task-b'] }
const request = { fromTaskId: 'task-a', toTaskId: 'task-b', taskIds: ['task-a', 'task-b'], planRevision: 3, reason: 'Reviewer confirmed the actual task from the full photograph.', now: 'now' }
describe('photo placement after content review', () => {
  it('moves only proven single-task coverage, preserving the original placement and retry identity', () => {
    const patch = photoPlacementPatch(photo, request)
    expect(patch).toMatchObject({ taskId: 'task-b', originalTaskId: 'task-a' })
    expect(patch.storage).toBeUndefined()
    expect(patch.status).toBeUndefined()
    expect(photoPlacementPatch({ ...photo, ...patch }, request)).toBeNull()
  })
  it.each([{ coveredTaskIds: ['task-a', 'task-b'] }, { coveredTaskIds: [] }, { planRevision: 2 }, { status: 'pending' }, { storage: { state: 'uploaded' } }])('rejects ambiguous, stale or unreviewed placement %j', change => {
    expect(() => photoPlacementPatch({ ...photo, ...change }, request)).toThrow('photo_placement_unproven')
  })
  it('allows the same correction atomically as a completed review', () => {
    expect(photoPlacementPatch({ ...photo, status: 'pending' }, { ...request, reviewComplete: true })).toMatchObject({ taskId: 'task-b' })
  })
  it('checks the owned student day and revision before writing, then verifies the saved photo', async () => {
    const docs = new Map(); const token = 'x'.repeat(30), uploadId = 'u'.repeat(30)
    docs.set(`dayOwners/${token}`, { familyId: 'family', childId: 'child', date: '2026-10-28' })
    docs.set(`dayPages/${token}`, { kind: 'student', planRevision: 3, taskIds: request.taskIds })
    const path = `dayUploads/${token}/files/${uploadId}`; docs.set(path, photo)
    const snap = key => ({ exists: docs.has(key), data: () => docs.get(key) })
    const db = { doc: path => ({ path, get: async () => snap(path) }), runTransaction: fn => fn({ get: async ref => snap(ref.path), update: (ref, patch) => docs.set(ref.path, { ...docs.get(ref.path), ...patch }) }) }
    const input = { ...request, date: '2026-10-28', dayToken: token, uploadId }
    expect(await relocateReviewedPhoto(db, input, 'now')).toEqual({ changed: true, verified: true })
    expect(await relocateReviewedPhoto(db, input, 'later')).toEqual({ changed: false, verified: true })
    expect(docs.get(path).storage).toEqual(photo.storage)
    await expect(relocateReviewedPhoto(db, { ...input, planRevision: 4 }, 'now')).rejects.toThrow('owner_or_revision')
  })
})
