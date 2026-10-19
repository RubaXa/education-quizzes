import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  sources: new Map<string, Record<string, unknown>>(),
  events: new Map<string, Record<string, unknown>>(),
  timestamp: 0,
}))

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  getDocFromServer: async (ref: { path: string }) => {
    const data = ref.path === 'dayOwners/day-token'
      ? { familyId: 'family-1', childId: 'child-1' }
      : harness.sources.get(ref.path)
    return { exists: () => Boolean(data), data: () => data }
  },
  getDocs: async () => ({ docs: [] }),
  onSnapshot: () => () => {},
  serverTimestamp: () => ({ seconds: ++harness.timestamp, nanoseconds: 0 }),
  writeBatch: () => {
    const writes: Array<{ path: string; value: Record<string, unknown> }> = []
    return {
      set: (ref: { path: string }, value: Record<string, unknown>) => writes.push({ path: ref.path, value }),
      commit: async () => {
        for (const write of writes) {
          const store = write.path.startsWith('educationEvents/') ? harness.events : harness.sources
          if (store.has(write.path)) throw new Error('already-exists')
        }
        for (const write of writes) {
          const store = write.path.startsWith('educationEvents/') ? harness.events : harness.sources
          store.set(write.path, write.value)
        }
      },
    }
  },
}))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'auth-1' } }) }))
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('./personalAccess', () => ({ currentEducationPersonId: () => 'person-1' }))
vi.mock('./educationEventProducer', () => ({
  prepareEducationEvent: async (input: { operationId: string }) => ({ ...input, eventId: `event-${input.operationId}` }),
  stagePreparedEducationEvent: (batch: { set: (ref: { path: string }, value: Record<string, unknown>) => void }, event: { eventId: string }) => {
    batch.set({ path: `educationEvents/${event.eventId}` }, event)
  },
}))

import { recordVariantChoice, variantRequired, type ParentCompletionEvent } from './parentCompletion'

describe('parent decision event producer', () => {
  beforeEach(() => {
    harness.sources.clear()
    harness.events.clear()
    harness.timestamp = 0
  })

  it('records required → optional → required as three actions, while the same operation retry is idempotent', async () => {
    const taskId = 'task-1'
    const variantId = `${taskId}-v1`
    const operations = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]

    await recordVariantChoice('day-token', taskId, variantId, true, operations[0])
    await recordVariantChoice('day-token', taskId, variantId, false, operations[1])
    await recordVariantChoice('day-token', taskId, variantId, true, operations[2])
    await recordVariantChoice('day-token', taskId, variantId, true, operations[2])

    const decisions = [...harness.sources.entries()].filter(([path]) => path.startsWith('dayParentDecisions/'))
      .map(([, data]) => data as unknown as ParentCompletionEvent)
    expect(decisions).toHaveLength(3)
    expect([...harness.events.keys()]).toHaveLength(3)
    expect(decisions.map(({ action }) => action)).toEqual(['variant-required', 'variant-optional', 'variant-required'])
    expect(variantRequired(taskId, variantId, decisions)).toBe(true)
  })
})
