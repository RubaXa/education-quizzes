import { beforeEach, describe, expect, it, vi } from 'vitest'

const scene = vi.hoisted(() => ({
  docs: {} as Record<string, Record<string, unknown>>,
  reads: [] as string[],
  writes: [] as { path: string; data: Record<string, unknown> }[],
  queue: [] as { path: string; data: Record<string, unknown> }[],
  draftUpdates: [] as { args: unknown[] }[],
}))

vi.mock('./firebase', () => ({ db: {} }))
vi.mock('./personalAccess', () => ({ currentEducationPersonId: () => 'parent-person' }))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'device-1' } }) }))
vi.mock('./educationEventProducer', () => ({
  prepareEducationEvent: async (input: any) => ({ eventId: `queue-${input.operationId}`, eventType: input.eventType, familyId: input.familyId,
    childId: input.childId, source: input.source, sourceRef: input.sourceRef, operationId: input.operationId, actor: input.actor,
    schemaVersion: 1, state: 'pending', attempts: 0 }),
  stagePreparedEducationEventInTransaction: (tx: any, envelope: any) => {
    tx.set(`educationEvents/${envelope.eventId}`, envelope)
  },
}))
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  updateDoc: async (...args: unknown[]) => { scene.draftUpdates.push({ args }) },
  doc: (_db: unknown, _collection: string, token: string) => `assignments/${token}`,
  serverTimestamp: () => 'SERVER_TIME',
  runTransaction: async (_db: unknown, callback: (tx: unknown) => Promise<void>) => callback({
    get: async (path: string) => {
      scene.reads.push(path)
      const data = scene.docs[path]
      return { exists: () => Boolean(data), data: () => data }
    },
    update: (path: string, data: Record<string, unknown>) => { scene.writes.push({ path, data }) },
    set: (path: string, data: Record<string, unknown>) => { scene.queue.push({ path, data }) },
  }),
}))

import { readLearningContext, requestQuizFollowup, saveDraft, setQuizRequired, submitAssignment } from './store'

describe('public placement metadata', () => {
  it('reads valid placements and ignores absent or malformed legacy data', () => {
    expect(readLearningContext({ kind: 'olympiad', id: 'formulo-2026' })).toEqual({ kind: 'olympiad', id: 'formulo-2026' })
    expect(readLearningContext(undefined)).toBeUndefined()
    expect(readLearningContext({ kind: 'olympiad', id: '../secret' })).toBeUndefined()
    expect(readLearningContext({ kind: 'olympiad', id: 'ok', key: 'hidden' })).toBeUndefined()
  })
})

beforeEach(() => {
  scene.docs = { 'assignments/root': { testId: 'math-1', status: 'open', familyId: 'family', childId: 'child' } }
  scene.reads = []
  scene.writes = []
  scene.queue = []
  scene.draftUpdates = []
})

describe('quiz start event producer', () => {
  it('appends one event with the first start and none for later answer edits', async () => {
    scene.docs['assignments/root'] = { ...scene.docs['assignments/root'], startedAt: null, answers: {} }
    await saveDraft('root', { q1: 'A' }, false)
    expect(scene.writes[0]).toMatchObject({ path: 'assignments/root', data: {
      status: 'open', startedAt: 'SERVER_TIME', eventOperationId: 'quiz-start:root', eventProducerVersion: 1,
    } })
    expect(scene.queue).toHaveLength(1)
    expect(scene.queue[0].data).toMatchObject({ eventType: 'quiz.started', operationId: 'quiz-start:root',
      sourceRef: { kind: 'quiz', documentPath: 'assignments/root', quizToken: 'root' }, actor: { uid: 'device-1' } })
    Object.assign(scene.docs['assignments/root'], scene.writes[0].data)

    await saveDraft('root', { q2: 'B' }, false)
    expect(scene.queue).toHaveLength(1)
    await saveDraft('root', { q3: 'C' }, true)
    expect(scene.draftUpdates).toHaveLength(1)
    expect(scene.queue).toHaveLength(1)
  })
})

/** @see ../../docs/modules/assessments/quizzes.md#optional-quiz */
describe('parent family choice is an isolated assignment write', () => {
  it('turns an open root test optional with one read and without touching answers', async () => {
    await setQuizRequired('root', 'root', false)
    expect(scene.reads).toEqual(['assignments/root'])
    expect(scene.writes).toHaveLength(1)
    expect(scene.writes[0]).toMatchObject({ path: 'assignments/root', data: {
      familyOptional: true, familyChoiceAt: 'SERVER_TIME', familyChoiceBy: 'parent-person', eventProducerVersion: 1,
    } })
    expect(scene.queue).toHaveLength(1)
    expect(scene.queue[0].data).toMatchObject({ eventType: 'quiz.requirement_changed', sourceRef: { documentPath: 'assignments/root' }, actor: { uid: 'device-1' } })
  })
  it('restores the root choice while a linked attempt is open', async () => {
    scene.docs['assignments/root'] = { ...scene.docs['assignments/root'], status: 'submitted', familyOptional: true }
    scene.docs['assignments/retry'] = { testId: 'math-2', linkedToTestId: 'math-1', status: 'open', familyId: 'family', childId: 'child' }
    await setQuizRequired('root', 'retry', true)
    expect(scene.reads).toEqual(['assignments/root', 'assignments/retry'])
    expect(scene.writes[0]).toMatchObject({ path: 'assignments/root', data: { familyOptional: false } })
    expect(scene.queue[0].data.eventType).toBe('quiz.requirement_changed')
  })
  it('refuses a submitted current attempt or another child', async () => {
    scene.docs['assignments/retry'] = { testId: 'math-2', status: 'submitted', familyId: 'family', childId: 'child' }
    await expect(setQuizRequired('root', 'retry', false)).rejects.toThrow('Активный тест изменился')
    scene.docs['assignments/retry'].status = 'open'
    scene.docs['assignments/retry'].childId = 'other'
    await expect(setQuizRequired('root', 'retry', false)).rejects.toThrow('Активный тест изменился')
    expect(scene.writes).toEqual([])
  })
})

/** @see ../../docs/modules/assessments/quizzes.md#followup-request */
describe('universal parent continuation uses the same narrow transaction', () => {
  it('accepts a completed 100% attempt, reads once and writes only the request fields', async () => {
    scene.docs['assignments/root'] = { ...scene.docs['assignments/root'], status: 'submitted', points: 5, maxPoints: 5, answers: { a: 'right' } }
    await requestQuizFollowup('root', 'math-1')
    expect(scene.reads).toEqual(['assignments/root'])
    expect(scene.writes).toHaveLength(1)
    expect(scene.writes[0]).toMatchObject({ path: 'assignments/root', data: { followupRequestedAt: 'SERVER_TIME', followupRequestedBy: 'parent-person', eventProducerVersion: 1 } })
    expect(scene.queue).toHaveLength(1)
    expect(scene.queue[0].data.eventType).toBe('quiz.followup_requested')
    Object.assign(scene.docs['assignments/root'], scene.writes[0].data)
    await requestQuizFollowup('root', 'math-1')
    expect(scene.writes).toHaveLength(1)
    expect(scene.queue).toHaveLength(1)
    expect(scene.docs['assignments/root'].answers).toEqual({ a: 'right' })
  })
  it('rejects an unsubmitted or replaced attempt without persisting a request', async () => {
    await expect(requestQuizFollowup('root', 'math-1')).rejects.toThrow('Результат теста изменился')
    scene.docs['assignments/root'].status = 'submitted'
    await expect(requestQuizFollowup('root', 'other-test')).rejects.toThrow('Результат теста изменился')
    expect(scene.writes).toEqual([])
  })
})

describe('quiz submission event producer', () => {
  it('appends one scoped event in the same transaction as the submitted state', async () => {
    await submitAssignment('root')
    expect(scene.writes).toHaveLength(1)
    expect(scene.writes[0]).toMatchObject({ path: 'assignments/root', data: { status: 'submitted' } })
    expect(scene.queue).toHaveLength(1)
    expect(scene.queue[0].data).toMatchObject({
      eventType: 'quiz.submitted', familyId: 'family', childId: 'child', source: 'firestore',
      sourceRef: { kind: 'quiz', documentPath: 'assignments/root', quizToken: 'root' },
      operationId: 'quiz-submit:root', actor: { type: 'user', uid: 'device-1' },
    })
    scene.docs['assignments/root'].status = 'submitted'
    await expect(submitAssignment('root')).rejects.toThrow('Этот тест уже отправлен')
    expect(scene.queue).toHaveLength(1)
  })
})
