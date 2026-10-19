import { describe, expect, it } from 'vitest'
import { createEducationEventId } from '../packages/education-events/envelope.mjs'
import { stageReviewPublishedEvents } from './review-publication-event.mjs'

describe('review publication queue producer', () => {
  it('stages review projections and review.published in the same immutable batch', async () => {
    const writes = []
    const batch = {
      set: (ref, data) => writes.push({ method: 'set', path: ref.path, data }),
      create: (ref, data) => writes.push({ method: 'create', path: ref.path, data }),
    }
    const db = { doc: (path) => ({ path, get: async () => ({ exists: false }) }) }
    const owner = { id: 'day-student', data: () => ({ familyId: 'family-1', childId: 'child-1' }) }
    const entries = [{ taskId: 'task-1', status: 'verified', summary: 'private review prose' }]

    for (const entry of entries) batch.set({ path: `dayProgress/${owner.id}/items/${entry.taskId}` }, { status: entry.status })
    const [eventId] = await stageReviewPublishedEvents(db, batch, owner, entries)

    expect(writes).toHaveLength(2)
    expect(writes.map(({ path }) => path)).toEqual([`dayProgress/${owner.id}/items/task-1`, `educationEvents/${eventId}`])
    expect(writes[1].method).toBe('create')
    expect(writes[1].data).toMatchObject({ eventType: 'review.published', eventId,
      familyId: 'family-1', childId: 'child-1', source: 'firestore', actor: { type: 'system', id: 'submissions' },
      sourceRef: { kind: 'review', documentPath: 'dayProgress/day-student/items/task-1', dayToken: 'day-student', taskId: 'task-1' } })
    expect(writes[1].data.operationId).toContain('review-published:day-student:task-1:')
    expect(await createEducationEventId({ eventType: 'review.published', familyId: 'family-1', childId: 'child-1',
      source: 'firestore', sourceRef: writes[1].data.sourceRef, operationId: writes[1].data.operationId })).toBe(eventId)
    expect(JSON.stringify(writes[1].data)).not.toContain('private review prose')
  })
})
