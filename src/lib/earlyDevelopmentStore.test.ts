// @vitest-environment jsdom
/** @see ../../docs/modules/families/early-development.md */
import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ data: null as Record<string, unknown> | null, listener: null as ((snapshot: any) => void) | null, writes: [] as Array<{ path: string; data: Record<string, unknown> }> }))
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('./personalAccess', () => ({ currentEducationPersonId: () => 'parent' }))
vi.mock('firebase/firestore', () => ({
  doc: (base: unknown, ...path: string[]) => ({ path: [...(base && typeof base === 'object' && 'path' in base ? [base.path] : []), ...path].join('/') }),
  serverTimestamp: () => 'SERVER_TIME', Timestamp: { fromDate: (date: Date) => date.toISOString() }, collection: vi.fn(), query: vi.fn(), limit: vi.fn(), orderBy: vi.fn(), onSnapshot: (_ref: unknown, _options: unknown, next: (snapshot: any) => void) => { fake.listener = next; return vi.fn() },
  runTransaction: async (_db: unknown, work: (tx: unknown) => Promise<void>) => { const writes: typeof fake.writes = []; await work({ get: async () => ({ exists: () => !!fake.data, data: () => fake.data }), set: (ref: { path: string }, data: Record<string, unknown>) => writes.push({ path: ref.path, data }) }); fake.writes = writes },
}))
import { saveEarlyObservation, watchEarlyJournal } from './earlyDevelopmentStore'
const child = { familyId: 'family', childId: 'baby', displayName: 'Малыш', role: 'parent' as const }
const entry = { id: 'episode', activityId: 'voice', activityTitle: 'Голос', programVersion: 'v1', observedAt: '2026-10-22T12:00:00.000Z', reaction: 'Другое' as const, note: '' }
beforeEach(() => { fake.data = null; fake.writes = [] })
it('commits current observation and identical audit revision atomically', async () => {
  await saveEarlyObservation(child, entry)
  expect(fake.writes).toHaveLength(2)
  expect(fake.writes[0].data).toEqual(fake.writes[1].data)
  expect(fake.writes[1].path).toContain('/history/')
  expect(fake.writes[0].data).toMatchObject({ revision: 1, authorId: 'parent', deleted: false, updatedAt: 'SERVER_TIME' })
})
it('rejects a stale form instead of overwriting a change from another phone', async () => {
  fake.data = { ...entry, revision: 2 }
  await expect(saveEarlyObservation(child, { ...entry, note: 'old draft' }, { ...entry, revision: 1 })).rejects.toThrow('другом устройстве')
  expect(fake.writes).toHaveLength(0)
})
it('preserves the original creator and creation time when another parent edits', async () => {
  fake.data = { ...entry, revision: 1, authorId: 'other-parent', createdAt: 'ORIGINAL' }
  await saveEarlyObservation(child, { ...entry, deleted: true }, { ...entry, revision: 1 })
  expect(fake.writes[0].data).toMatchObject({ revision: 2, authorId: 'other-parent', createdAt: 'ORIGINAL', updatedBy: 'parent', deleted: true })
})

it('hydrates Firestore times for the journal only after server confirmation', () => {
  const next = vi.fn(), failed = vi.fn(); watchEarlyJournal(child, 200, next, failed)
  const timestamp = { toDate: () => new Date('2026-10-22T12:00:00.000Z') }
  const snapshot = { metadata: { fromCache: true }, docs: [{ id: 'episode', data: () => ({ ...entry, observedAt: timestamp, updatedAt: timestamp, revision: 2 }) }] }
  fake.listener!(snapshot); expect(next).not.toHaveBeenCalled()
  fake.listener!({ ...snapshot, metadata: { fromCache: false } })
  expect(next).toHaveBeenCalledWith([expect.objectContaining({ observedAt: '2026-10-22T12:00:00.000Z', updatedAt: '2026-10-22T12:00:00.000Z' })])
})
