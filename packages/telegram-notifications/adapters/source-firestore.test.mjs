import { describe, expect, it, vi } from 'vitest'
import { createFirestoreSourceAdapter } from './source-firestore.mjs'

function snapshot(rows) {
  return { docChanges: () => rows.map(([type, id, data]) => ({ type, doc: { id, data: () => data } })) }
}

function fakeDb() {
  const queries = new Map()
  return {
    queries,
    collection(path) {
      const filters = []
      const query = {
        where(field, operator, value) { filters.push([field, operator, value]); return query },
        onSnapshot(next, error) {
          const key = `${path}:${JSON.stringify(filters)}`
          const entries = queries.get(key) ?? []
          entries.push({ next, error })
          queries.set(key, entries)
          return vi.fn(() => { const index = entries.findIndex((entry) => entry.next === next); if (index >= 0) entries.splice(index, 1) })
        },
      }
      return query
    },
  }
}

describe('Firestore source discovery listeners', () => {
  it('emits candidates from scoped assignment/upload collections and refreshes owners across the inventory gap', () => {
    const db = fakeDb()
    const source = createFirestoreSourceAdapter(db)
    const onCandidate = vi.fn(), onInventoryChange = vi.fn()
    const stop = source.subscribeDiscovery({ targets: [
      { kind: 'assignments', familyId: 'fam-a' },
      { kind: 'dayOwners', familyId: 'fam-a', ownerIds: ['day-known'] },
      { kind: 'uploads', familyId: 'fam-a', childId: 'kid-a', dayToken: 'day-known' },
      { kind: 'progress', familyId: 'fam-a', childId: 'kid-a', dayToken: 'day-known' },
    ], onCandidate, onInventoryChange })

    const listen = (path, filters = []) => db.queries.get(`${path}:${JSON.stringify(filters)}`)?.[0]?.next
    listen('assignments', [['familyId', '==', 'fam-a']])(snapshot([
      ['added', 'quiz-a', { familyId: 'fam-a', childId: 'kid-a' }],
      ['added', 'foreign', { familyId: 'fam-b', childId: 'kid-a' }],
    ]))
    listen('dayOwners', [['familyId', '==', 'fam-a']])(snapshot([
      ['added', 'day-known', { familyId: 'fam-a', childId: 'kid-a', date: '2026-10-19' }],
      ['added', 'day-between-reads', { familyId: 'fam-a', childId: 'kid-a', date: '2026-10-19' }],
    ]))
    listen('dayUploads/day-known/files')(snapshot([['added', 'file-a', {}]]))
    listen('dayProgress/day-known/items')(snapshot([['added', 'item-a', {}]]))

    expect(onCandidate.mock.calls.map(([scope]) => [scope.kind, scope.quizToken ?? scope.recordId])).toEqual([
      ['quiz', 'quiz-a'], ['upload', 'file-a'], ['progress', 'item-a'],
    ])
    expect(onInventoryChange).toHaveBeenCalledOnce()
    listen('dayOwners', [['familyId', '==', 'fam-a']])(snapshot([
      ['removed', 'day-known', { familyId: 'fam-a', childId: 'kid-a', date: '2026-10-19' }],
    ]))
    expect(onInventoryChange).toHaveBeenCalledTimes(2)
    stop()
  })

  it('ignores callbacks after close and retries subscription errors with backoff', async () => {
    const db = fakeDb()
    const source = createFirestoreSourceAdapter(db, { setTimer: (fn) => { queueMicrotask(fn); return 1 }, clearTimer() {} })
    const onCandidate = vi.fn(), onError = vi.fn()
    const stop = source.subscribeDiscovery({ targets: [{ kind: 'uploads', familyId: 'fam-a', childId: 'kid-a', dayToken: 'day-a' }],
      onCandidate, onError })
    const entry = db.queries.get('dayUploads/day-a/files:[]')[0]
    entry.error()
    await Promise.resolve()
    await stop()
    entry.next(snapshot([['added', 'file-a', {}]]))
    expect(onError).toHaveBeenCalledWith({ code: 'source_listener_unavailable' })
    expect(onCandidate).not.toHaveBeenCalled()
  })

  it('acknowledges listener readiness only after every scoped target has its initial snapshot', () => {
    const db = fakeDb()
    const source = createFirestoreSourceAdapter(db)
    const onReady = vi.fn()
    const stop = source.subscribeDiscovery({ targets: [
      { kind: 'uploads', familyId: 'fam-a', childId: 'kid-a', dayToken: 'day-a' },
      { kind: 'progress', familyId: 'fam-a', childId: 'kid-a', dayToken: 'day-a' },
    ], onCandidate() {}, onReady })
    const upload = db.queries.get('dayUploads/day-a/files:[]')[0]
    const progress = db.queries.get('dayProgress/day-a/items:[]')[0]
    upload.next(snapshot([]))
    expect(onReady).not.toHaveBeenCalled()
    progress.next(snapshot([]))
    expect(onReady).toHaveBeenCalledExactlyOnceWith({ targetCount: 2 })
    stop()
  })
})
