import { describe, expect, it } from 'vitest'
import { createFirestoreSourceDiscoveryStore } from './source-discovery-firestore.mjs'

function storeDb() {
  const data = new Map()
  let tail = Promise.resolve()
  return {
    data,
    doc(path) { return { path, get: async () => ({ exists: data.has(path), data: () => data.get(path), ref: { path } }) } },
    runTransaction(callback) {
      const run = tail.then(async () => {
        const writes = []
        const tx = {
          get: async (ref) => ({ exists: data.has(ref.path), data: () => data.get(ref.path) }),
          create: (ref, value) => writes.push([ref.path, value]),
        }
        const result = await callback(tx)
        for (const [path, value] of writes) if (!data.has(path)) data.set(path, value)
        return result
      })
      tail = run.catch(() => {})
      return run
    },
  }
}

const inventory = (familyId, childId, quizToken) => ({ complete: true,
  families: [{ familyId }],
  scopes: [{ source: 'firestore', scope: { familyId, childId, kind: 'quiz', quizToken }, origin: 'bootstrap' }],
})

describe('Firestore source discovery manifest', () => {
  it('classifies first family silently and later scope additions as live across restarts', async () => {
    const db = storeDb()
    const store = createFirestoreSourceDiscoveryStore(db)
    const first = await store.prepare(inventory('fam-a', 'kid-a', 'quiz-a'))
    expect(first.scopes[0].origin).toBe('bootstrap')
    await store.confirm(first)

    const restart = createFirestoreSourceDiscoveryStore(db)
    const newScope = await restart.prepare(inventory('fam-a', 'kid-a', 'quiz-b'))
    expect(newScope.scopes[0].origin).toBe('live')
    await restart.confirm(newScope)
    const afterCrashBeforePipeline = await createFirestoreSourceDiscoveryStore(db).prepare(inventory('fam-a', 'kid-a', 'quiz-b'))
    expect(afterCrashBeforePipeline.scopes[0].origin).toBe('live')
    expect([...db.data.keys()].every((key) => /^(notify|shadow)_(context|scope)_[a-f0-9]{64}$/.test(key.split('/').at(-1)))).toBe(true)
  })

  it('does not store raw family, child, or day tokens in manifest paths or values', async () => {
    const db = storeDb()
    const store = createFirestoreSourceDiscoveryStore(db)
    const prepared = await store.prepare({ complete: true, families: [{ familyId: 'family-secret' }], scopes: [
      { source: 'firestore', scope: { familyId: 'family-secret', childId: 'child-secret', kind: 'upload', dayToken: 'day-secret', recordId: 'file-secret' }, origin: 'bootstrap' },
    ] })
    await store.confirm(prepared)
    const contents = JSON.stringify([...db.data.entries()])
    for (const secret of ['family-secret', 'child-secret', 'day-secret', 'file-secret']) expect(contents).not.toContain(secret)
  })

  it('uses child/account context and checkpoint namespace to keep new children and first notify quiet', async () => {
    const db = storeDb()
    const base = createFirestoreSourceDiscoveryStore(db, { namespace: 'shadow' })
    const knownChild = await base.prepare(inventory('fam-a', 'kid-a', 'quiz-a'))
    await base.confirm(knownChild)
    const newChild = await base.prepare(inventory('fam-a', 'kid-b', 'quiz-old'))
    expect(newChild.scopes[0].origin).toBe('bootstrap')
    const notify = await createFirestoreSourceDiscoveryStore(db, { namespace: 'notify' }).prepare(inventory('fam-a', 'kid-a', 'quiz-a'))
    expect(notify.scopes[0].origin).toBe('bootstrap')
  })

  it('keeps independently keyed Mesh accounts and dates distinct', async () => {
    const db = storeDb()
    const meshScopeKey = (_source, scope) => JSON.stringify([scope.sourceAccountId, scope.date])
    const store = createFirestoreSourceDiscoveryStore(db, { scopeKey: meshScopeKey })
    const data = { complete: true, contexts: [], families: [{ familyId: 'fam-a' }], scopes: [
      { source: 'mesh', scope: { familyId: 'fam-a', childId: 'kid-a', sourceAccountId: 'account-a', date: '2026-10-17' } },
      { source: 'mesh', scope: { familyId: 'fam-a', childId: 'kid-a', sourceAccountId: 'account-b', date: '2026-10-17' } },
      { source: 'mesh', scope: { familyId: 'fam-a', childId: 'kid-a', sourceAccountId: 'account-a', date: '2026-10-18' } },
    ] }
    const prepared = await store.prepare(data)
    expect(new Set(prepared.scopeHashes).size).toBe(3)
    expect(new Set(prepared.contextHashes).size).toBe(2)
  })

  it('baselines a newly discovered Mesh date or grade period shard inside an existing child context', async () => {
    const db = storeDb()
    const store = createFirestoreSourceDiscoveryStore(db, { scopeKey: (_source, scope) => JSON.stringify(scope) })
    const context = { source: 'mesh', scope: { familyId: 'fam-a', childId: 'kid-a', sourceAccountId: 'account-a' } }
    const initialScope = { source: 'mesh', scope: { ...context.scope, kind: 'schedule', date: '2026-10-17' } }
    const initial = await store.prepare({ complete: true, contexts: [context], families: [{ familyId: 'fam-a' }], scopes: [initialScope] })
    expect(initial.scopes[0].origin).toBe('bootstrap')
    await store.confirm(initial)
    const nextDate = { source: 'mesh', scope: { ...context.scope, kind: 'schedule', date: '2026-10-18' } }
    const newPeriod = { source: 'mesh', scope: { ...context.scope, kind: 'grades', subjectId: 'math', periodKey: '2026-10-01' } }
    const later = await store.prepare({ complete: true, contexts: [context], families: [{ familyId: 'fam-a' }], scopes: [nextDate, newPeriod] })
    expect(later.scopes.map((item) => item.origin)).toEqual(['bootstrap', 'bootstrap'])
  })

  it('keeps bootstrap scope origins durable if context completion fails midway', async () => {
    const db = storeDb()
    const base = createFirestoreSourceDiscoveryStore(db)
    const initial = { complete: true, contexts: [{ source: 'firestore', scope: { familyId: 'fam-a', childId: 'kid-a' } }],
      families: [{ familyId: 'fam-a' }], scopes: [
        { source: 'firestore', scope: { familyId: 'fam-a', childId: 'kid-a', kind: 'quiz', quizToken: 'old-a' } },
        { source: 'firestore', scope: { familyId: 'fam-a', childId: 'kid-a', kind: 'quiz', quizToken: 'old-b' } },
      ] }
    const prepared = await base.prepare(initial)
    const original = db.runTransaction.bind(db)
    let contextWrites = 0
    db.runTransaction = (callback) => original(async (tx) => {
      const wrapped = { ...tx, create(ref, value) {
        if (value.kind === 'context' && ++contextWrites === 1) throw new Error('simulated crash')
        tx.create(ref, value)
      } }
      return callback(wrapped)
    })
    await expect(base.confirm(prepared)).rejects.toThrow('simulated crash')
    db.runTransaction = original
    const restart = await createFirestoreSourceDiscoveryStore(db).prepare(initial)
    expect(restart.scopes.map((item) => item.origin)).toEqual(['bootstrap', 'bootstrap'])
  })

  it('keeps the first concurrent bootstrap origin immutable', async () => {
    const db = storeDb()
    const one = createFirestoreSourceDiscoveryStore(db)
    const two = createFirestoreSourceDiscoveryStore(db)
    const input = inventory('fam-a', 'kid-a', 'quiz-a')
    const [first, second] = await Promise.all([one.prepare(input), two.prepare(input)])
    await Promise.all([one.confirm(first), two.confirm(second)])
    const restarted = await createFirestoreSourceDiscoveryStore(db).prepare(input)
    expect(restarted.scopes[0].origin).toBe('bootstrap')
  })
})
