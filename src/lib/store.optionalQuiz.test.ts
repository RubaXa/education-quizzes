import { beforeEach, describe, expect, it, vi } from 'vitest'

const scene = vi.hoisted(() => ({
  docs: {} as Record<string, Record<string, unknown>>,
  reads: [] as string[],
  writes: [] as { path: string; data: Record<string, unknown> }[],
}))

vi.mock('./firebase', () => ({ db: {} }))
vi.mock('./personalAccess', () => ({ currentEducationPersonId: () => 'parent-person' }))
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  doc: (_db: unknown, _collection: string, token: string) => `assignments/${token}`,
  serverTimestamp: () => 'SERVER_TIME',
  runTransaction: async (_db: unknown, callback: (tx: unknown) => Promise<void>) => callback({
    get: async (path: string) => {
      scene.reads.push(path)
      const data = scene.docs[path]
      return { exists: () => Boolean(data), data: () => data }
    },
    update: (path: string, data: Record<string, unknown>) => { scene.writes.push({ path, data }) },
  }),
}))

import { requestQuizFollowup, setQuizRequired } from './store'

beforeEach(() => {
  scene.docs = { 'assignments/root': { testId: 'math-1', status: 'open', familyId: 'family', childId: 'child' } }
  scene.reads = []
  scene.writes = []
})

/** @see ../../docs/product/quizzes.md#optional-quiz */
describe('parent family choice is an isolated assignment write', () => {
  it('turns an open root test optional with one read and without touching answers', async () => {
    await setQuizRequired('root', 'root', false)
    expect(scene.reads).toEqual(['assignments/root'])
    expect(scene.writes).toEqual([{ path: 'assignments/root', data: {
      familyOptional: true, familyChoiceAt: 'SERVER_TIME', familyChoiceBy: 'parent-person',
    } }])
  })
  it('restores the root choice while a linked attempt is open', async () => {
    scene.docs['assignments/root'] = { ...scene.docs['assignments/root'], status: 'submitted', familyOptional: true }
    scene.docs['assignments/retry'] = { testId: 'math-2', linkedToTestId: 'math-1', status: 'open', familyId: 'family', childId: 'child' }
    await setQuizRequired('root', 'retry', true)
    expect(scene.reads).toEqual(['assignments/root', 'assignments/retry'])
    expect(scene.writes[0]).toMatchObject({ path: 'assignments/root', data: { familyOptional: false } })
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

/** @see ../../docs/product/quizzes.md#followup-request */
describe('universal parent continuation uses the same narrow transaction', () => {
  it('accepts a completed 100% attempt, reads once and writes only the request fields', async () => {
    scene.docs['assignments/root'] = { ...scene.docs['assignments/root'], status: 'submitted', points: 5, maxPoints: 5, answers: { a: 'right' } }
    await requestQuizFollowup('root', 'math-1')
    expect(scene.reads).toEqual(['assignments/root'])
    expect(scene.writes).toEqual([{ path: 'assignments/root', data: { followupRequestedAt: 'SERVER_TIME', followupRequestedBy: 'parent-person' } }])
    Object.assign(scene.docs['assignments/root'], scene.writes[0].data)
    await requestQuizFollowup('root', 'math-1')
    expect(scene.writes).toHaveLength(1)
    expect(scene.docs['assignments/root'].answers).toEqual({ a: 'right' })
  })
  it('rejects an unsubmitted or replaced attempt without persisting a request', async () => {
    await expect(requestQuizFollowup('root', 'math-1')).rejects.toThrow('Результат теста изменился')
    scene.docs['assignments/root'].status = 'submitted'
    await expect(requestQuizFollowup('root', 'other-test')).rejects.toThrow('Результат теста изменился')
    expect(scene.writes).toEqual([])
  })
})
