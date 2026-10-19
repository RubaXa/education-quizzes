import { describe, expect, it } from 'vitest'
import { canonicalEducationEventSourceRef, createEducationEvent, createEducationEventId } from './envelope.mjs'

const base = {
  eventType: 'quiz.submitted', familyId: 'family-1', childId: 'child-1', source: 'firestore',
  sourceRef: { kind: 'quiz', documentPath: 'assignments/token-1', quizToken: 'token-1' }, operationId: 'submit-1',
}

describe('education event envelope identity', () => {
  it('is stable across object key order and retry', async () => {
    const first = await createEducationEventId(base)
    const second = await createEducationEventId({ ...base, sourceRef: { quizToken: 'token-1', documentPath: 'assignments/token-1', kind: 'quiz' } })
    expect(first).toBe(second)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  it('separates operations and source scope', async () => {
    const first = await createEducationEventId(base)
    expect(await createEducationEventId({ ...base, operationId: 'submit-2' })).not.toBe(first)
    expect(await createEducationEventId({ ...base, childId: 'child-2' })).not.toBe(first)
  })

  it('accepts review projections as canonical review sources', () => {
    expect(canonicalEducationEventSourceRef({ kind: 'review', dayToken: 'day-b', taskId: 'task-b',
      documentPath: 'dayProgress/day-b/items/task-b' })).toEqual({
      dayToken: 'day-b', documentPath: 'dayProgress/day-b/items/task-b', kind: 'review', taskId: 'task-b',
    })
  })

  it('returns the exact privacy-safe common envelope', async () => {
    const timestamp = { sentinel: true }
    const envelope = await createEducationEvent({ ...base, actor: { type: 'user', uid: 'uid-1' } }, timestamp)
    expect(envelope).toMatchObject({ schemaVersion: 1, eventType: 'quiz.submitted', eventId: await createEducationEventId(base),
      operationId: 'submit-1', actor: { type: 'user', uid: 'uid-1' }, state: 'pending', createdAt: timestamp, availableAt: timestamp, attempts: 0 })
    expect(Object.keys(envelope).sort()).toEqual(['actor', 'attempts', 'availableAt', 'childId', 'createdAt', 'eventId', 'eventType', 'familyId', 'operationId', 'schemaVersion', 'source', 'sourceRef', 'state'].sort())
  })

  it('rejects missing identity and source path', async () => {
    await expect(createEducationEventId({ ...base, operationId: '' })).rejects.toThrow()
    expect(() => canonicalEducationEventSourceRef({ kind: 'quiz', documentPath: '' })).toThrow()
    expect(() => canonicalEducationEventSourceRef({ kind: 'quiz', documentPath: 'assignments/token-1', quizToken: 'elsewhere' })).toThrow()
    expect(() => canonicalEducationEventSourceRef({ kind: 'help', documentPath: 'dayHelp/token/items/task', taskId: 'task', dayToken: 'token', extra: { private: true } })).toThrow()
    await expect(createEducationEvent({ ...base, actor: { type: 'system', id: 'server', uid: 'spoof' } }, { sentinel: true })).rejects.toThrow()
  })
})
