import { afterEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({ personId: 'parent', switchAfterCommit: false, reads: 0, pages: [] as Array<Array<{ id: string; readAt?: string }>>,
  batches: [] as string[][], cached: [] as string[][], queryParts: [] as unknown[][] }))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'device' } }), onAuthStateChanged: vi.fn() }))
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('./personalAccess', () => ({ currentEducationPersonId: () => probe.personId, restorePersonalSession: vi.fn() }))
vi.mock('./inboxCache', () => ({ markCachedInboxRead: (_person: string, ids: string[]) => probe.cached.push(ids), writeCachedInbox: vi.fn() }))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  orderBy: (...args: unknown[]) => ['orderBy', ...args],
  limit: (count: number) => ['limit', count],
  startAfter: (cursor: { id: string }) => ['startAfter', cursor.id],
  query: (_collection: unknown, ...parts: unknown[]) => { probe.queryParts.push(parts); return parts },
  getDocsFromServer: async () => {
    const page = probe.pages[probe.reads++] ?? []
    return { size: page.length, docs: page.map((item) => ({ id: item.id, data: () => item })) }
  },
  writeBatch: () => {
    const ids: string[] = []
    return { update: (path: string) => ids.push(path.split('/').at(-1)!), commit: async () => { probe.batches.push(ids); if (probe.switchAfterCommit) probe.personId = 'other' } }
  },
  serverTimestamp: () => 'server-time',
  onSnapshot: vi.fn(), runTransaction: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(),
}))

import { markAllNotificationsRead } from './educationStore'

afterEach(() => { probe.personId = 'parent'; probe.switchAfterCommit = false; probe.reads = 0; probe.pages = []; probe.batches = []; probe.cached = []; probe.queryParts = [] })

describe('read all personal updates', () => {
  it('continues beyond the bell’s 100-item window and skips already read records', async () => {
    probe.pages = [
      Array.from({ length: 400 }, (_, index) => ({ id: `old-${index}`, ...(index % 2 ? { readAt: 'read' } : {}) })),
      [{ id: 'older-unread' }, { id: 'older-read', readAt: 'read' }],
    ]
    expect(await markAllNotificationsRead()).toBe(201)
    expect(probe.reads).toBe(2)
    expect(probe.queryParts[1]).toContainEqual(['startAfter', 'old-399'])
    expect(probe.batches.map((items) => items.length)).toEqual([200, 1])
    expect(probe.cached.flat()).toHaveLength(201)
  })
  it('stops before the next page if the personal session changes', async () => {
    probe.pages = [Array.from({ length: 400 }, (_, index) => ({ id: `old-${index}` }))]
    probe.switchAfterCommit = true
    // The first page is safe to acknowledge; the next page must belong to the same person.
    await expect(markAllNotificationsRead()).rejects.toThrow('Личная сессия изменилась')
    expect(probe.batches).toHaveLength(1)
    expect(probe.reads).toBe(1)
  })
})
