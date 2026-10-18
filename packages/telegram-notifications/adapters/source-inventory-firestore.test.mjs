import { describe, expect, it, vi } from 'vitest'
import { createFirestoreSourceInventory } from './source-inventory-firestore.mjs'
import { SourceCoordinator } from './source-coordinator.mjs'
import { createHash } from 'node:crypto'

function fakeDb(rows, failPath = null) {
  return {
    collection: (path) => query(path, [], null),
    doc: (path) => ({ get: async () => {
      const [collection, id] = path.split('/')
      const row = (rows[collection] ?? []).find((item) => item.id === id)
      return { exists: Boolean(row), data: () => row?.data }
    } }),
  }
  function query(path, filters, cursor, fields = null) {
    return {
      where(field, op, value) { return query(path, [...filters, { field, op, value }], cursor, fields) },
      select(...selected) { return query(path, filters, cursor, selected) },
      orderBy() { return query(path, filters, cursor, fields) },
      limit(size) { return { ...query(path, filters, cursor, fields), pageSize: size,
        get: async () => {
          if (failPath === path) throw Object.assign(new Error('fixture failure'), { code: 'unavailable' })
          const all = (rows[path] ?? []).filter((row) => filters.every((filter) => filter.op === '==' && row.data[filter.field] === filter.value))
            .sort((a, b) => a.id.localeCompare(b.id))
          const start = cursor ? all.findIndex((row) => row.id === cursor.id) + 1 : 0
          const selected = all.slice(start, start + size)
          return { docs: selected.map((row) => ({ id: row.id, data: () => fields ? Object.fromEntries(fields.filter((field) => field).map((field) => [field, row.data[field]])) : row.data })) }
        } }
      },
      startAfter(doc) { return query(path, filters, doc, fields) },
    }
  }
}

const d = (id, data = {}) => ({ id, data })
const accountId = (actorId) => createHash('sha256').update(`mesh-parent:${actorId}`).digest('hex')

describe('Firestore source inventory', () => {
  it('drains multiple pages across families and family-scoped owners/assignments', async () => {
    const rows = {
      families: [d('fam-a'), d('fam-b'), d('fam-c')],
      'families/fam-a/members': [d('parent-a', { role: 'parent', active: true, childIds: ['kid-a'] })],
      'families/fam-a/children': [d('kid-a', { meshPersonId: 'mesh-a' })],
      'families/fam-b/members': [d('parent-b', { role: 'parent', active: true, childIds: [] })],
      'families/fam-b/children': [d('kid-b')],
      'families/fam-c/members': [], 'families/fam-c/children': [],
      sourceAccounts: [d(accountId('actor-a'), { source: 'mesh', familyId: 'fam-a', personId: 'parent-a', sourcePersonId: 'actor-a' })],
      assignments: [d('quiz-a', { familyId: 'fam-a', childId: 'kid-a' }), d('quiz-b', { familyId: 'fam-a', childId: 'kid-a' }), d('quiz-foreign', { familyId: 'fam-z', childId: 'kid-a' })],
      dayOwners: [d('day-a', { familyId: 'fam-a', childId: 'kid-a', date: '2026-10-17' })],
      'dayUploads/day-a/files': [d('file-a'), d('file-b')],
      'dayProgress/day-a/items': [d('item-a')],
    }
    const inventory = await createFirestoreSourceInventory(fakeDb(rows), { pageSize: 1 }).enumerate()
    expect(inventory.complete, JSON.stringify(inventory.failures)).toBe(true)
    expect(inventory.families).toHaveLength(3)
    expect(inventory.registeredChildren).toHaveLength(2)
    expect(inventory.registeredChildren.find((x) => x.childId === 'kid-b').hasMeshIdentity).toBe(false)
    expect(inventory.sourceAccounts).toEqual([{ familyId: 'fam-a', accountId: accountId('actor-a'), personId: 'parent-a', sourcePersonId: 'actor-a' }])
    expect(inventory.scopes.map((item) => item.scope).map((scope) => scope.kind).sort())
      .toEqual(['progress', 'quiz', 'quiz', 'upload', 'upload'])
    expect(inventory.scopes.every((item) => item.scope.familyId === 'fam-a' && item.scope.childId === 'kid-a')).toBe(true)
  })

  it('marks failed enumeration incomplete so callers retain confirmed watchers', async () => {
    const inventory = await createFirestoreSourceInventory(fakeDb({ families: [d('fam-a')], 'families/fam-a/members': [],
      'families/fam-a/children': [], sourceAccounts: [] }, 'families/fam-a/children')).enumerate()
    expect(inventory.complete).toBe(false)
    expect(inventory.failures).toEqual([{ familyId: 'fam-a', source: 'firestore', code: 'unavailable' }])
  })

  it('continues to later families when one scoped family inventory fails', async () => {
    const rows = { families: [d('fam-a'), d('fam-b')],
      'families/fam-a/members': [], 'families/fam-a/children': [],
      'families/fam-b/members': [d('parent-b', { role: 'parent', active: true, childIds: ['kid-b'] })],
      'families/fam-b/children': [d('kid-b')], sourceAccounts: [],
      assignments: [d('quiz-b', { familyId: 'fam-b', childId: 'kid-b' })], dayOwners: [] }
    const inventory = await createFirestoreSourceInventory(fakeDb(rows, 'families/fam-a/children')).enumerate()
    expect(inventory.complete).toBe(false)
    expect(inventory.families).toEqual([{ familyId: 'fam-b' }])
    expect(inventory.scopes.map((item) => item.scope.quizToken)).toEqual(['quiz-b'])
  })

  it('rejects noncanonical day owners and ignores disconnected or mismatched source accounts', async () => {
    const rows = {
      families: [d('fam-a')],
      'families/fam-a/members': [d('parent-a', { role: 'parent', active: true, childIds: ['kid-a'] })],
      'families/fam-a/children': [d('kid-a')],
      sourceAccounts: [
        d(accountId('actor'), { source: 'mesh', familyId: 'fam-a', personId: 'parent-a', sourcePersonId: 'actor' }),
        d('off', { source: 'mesh', familyId: 'fam-a', personId: 'parent-a', sourcePersonId: 'actor', disconnectedAt: 'now' }),
      ],
      assignments: [d('foreign', { familyId: 'fam-b', childId: 'kid-a' })],
      dayOwners: [d('bad-owner', { familyId: 'fam-a', childId: 'kid-other', date: '2026-10-17' }),
        d('bad-date', { familyId: 'fam-a', childId: 'kid-a', date: '2026-02-30' })],
    }
    const inventory = await createFirestoreSourceInventory(fakeDb(rows)).enumerate()
    expect(inventory.complete).toBe(true)
    expect(inventory.sourceAccounts).toHaveLength(1)
    expect(inventory.scopes).toEqual([])
  })

  it('reports Mesh coverage from exact child identity and eligible parent-account ownership', async () => {
    const actor = 'actor-ready'
    const account = accountId(actor)
    const identityId = createHash('sha256').update('mesh-child:mesh-ready').digest('hex')
    const rows = {
      families: [d('fam-a')],
      'families/fam-a/members': [d('parent-a', { role: 'parent', active: true, childIds: ['kid-ready'] })],
      'families/fam-a/children': [d('kid-none'), d('kid-unregistered', { meshPersonId: 'mesh-unregistered' }),
        d('kid-owner', { meshPersonId: 'mesh-owner' }), d('kid-ready', { meshPersonId: 'mesh-ready' })],
      sourceAccounts: [d(account, { source: 'mesh', familyId: 'fam-a', personId: 'parent-a', sourcePersonId: actor })],
      sourceIdentities: [d(createHash('sha256').update('mesh-child:mesh-owner').digest('hex'),
        { source: 'mesh', familyId: 'fam-a', childId: 'kid-owner', sourcePersonId: 'mesh-owner' }),
      d(identityId, { source: 'mesh', familyId: 'fam-a', childId: 'kid-ready', sourcePersonId: 'mesh-ready' })],
    }
    const inventory = await createFirestoreSourceInventory(fakeDb(rows), { includeFirestore: false, includeMesh: true,
      now: () => new Date('2026-10-17T03:00:00.000Z'), meshSource: { discoverGradeScopes: async (scope) => [{ ...scope, subjectId: 'math', periodKey: '2026-09-01' }] } }).enumerate()
    expect(inventory.registeredChildren.map(({ childId, meshStatus, hasMeshIdentity, hasMeshAccount }) =>
      ({ childId, meshStatus, hasMeshIdentity, hasMeshAccount }))).toEqual([
      { childId: 'kid-none', meshStatus: 'not-linked', hasMeshIdentity: false, hasMeshAccount: false },
      { childId: 'kid-owner', meshStatus: 'owner-unavailable', hasMeshIdentity: true, hasMeshAccount: false },
      { childId: 'kid-ready', meshStatus: 'eligible', hasMeshIdentity: true, hasMeshAccount: true },
      { childId: 'kid-unregistered', meshStatus: 'identity-unregistered', hasMeshIdentity: true, hasMeshAccount: false },
    ])
    expect(inventory.scopes.filter(({ scope }) => scope.kind === 'grades')).toHaveLength(1)
    expect(inventory.scopes.filter(({ scope }) => scope.kind === 'grades')[0].scope.childId).toBe('kid-ready')
  })

  it('discovers every date and stable grades scope for each verified child/account pair', async () => {
    const sourcePersonId = 'mesh-child-a'
    const identityId = createHash('sha256').update(`mesh-child:${sourcePersonId}`).digest('hex')
    const rows = {
      families: [d('fam-a')],
      'families/fam-a/members': [d('parent-a', { role: 'parent', active: true, childIds: ['kid-a'] })],
      'families/fam-a/children': [d('kid-a', { meshPersonId: sourcePersonId })],
      sourceAccounts: [d(accountId('actor-a'), { source: 'mesh', familyId: 'fam-a', personId: 'parent-a', sourcePersonId: 'actor-a' })],
      sourceIdentities: [d(identityId, { source: 'mesh', familyId: 'fam-a', childId: 'kid-a', sourcePersonId })],
    }
    const inventory = await createFirestoreSourceInventory(fakeDb(rows), { includeFirestore: false, includeMesh: true,
      now: () => new Date('2026-10-17T03:00:00.000Z'),
      meshSource: { discoverGradeScopes: async (scope) => [{ ...scope, subjectId: 'math', periodKey: '2026-09-01' }] } }).enumerate()
    expect(inventory.complete).toBe(true)
    expect(inventory.scopes).toHaveLength(85)
    expect(inventory.scopes.filter((item) => item.scope.kind === 'grades')).toEqual([{ source: 'mesh', scope: expect.objectContaining({
      subjectId: 'math', periodKey: '2026-09-01', sourceAccountId: accountId('actor-a'), childId: 'kid-a' }), origin: 'bootstrap' }])
    expect(new Set(inventory.scopes.filter((item) => item.scope.kind === 'schedule').map((item) => item.scope.date)).size).toBe(42)
    expect(inventory.contexts).toEqual([{ source: 'mesh', scope: { familyId: 'fam-a', childId: 'kid-a', sourceAccountId: accountId('actor-a'), sourcePersonId } }])
  })

  it('isolates Mesh discovery failure to one child while retaining Firestore and healthy sibling scopes', async () => {
    const childA = 'mesh-child-a', childB = 'mesh-child-b'
    const identityA = createHash('sha256').update(`mesh-child:${childA}`).digest('hex')
    const identityB = createHash('sha256').update(`mesh-child:${childB}`).digest('hex')
    const rows = {
      families: [d('fam-a')],
      'families/fam-a/members': [d('parent-a', { role: 'parent', active: true, childIds: ['kid-a', 'kid-b'] })],
      'families/fam-a/children': [d('kid-a', { meshPersonId: childA }), d('kid-b', { meshPersonId: childB })],
      sourceAccounts: [d(accountId('actor-a'), { source: 'mesh', familyId: 'fam-a', personId: 'parent-a', sourcePersonId: 'actor-a' })],
      sourceIdentities: [d(identityA, { source: 'mesh', familyId: 'fam-a', childId: 'kid-a', sourcePersonId: childA }),
        d(identityB, { source: 'mesh', familyId: 'fam-a', childId: 'kid-b', sourcePersonId: childB })],
      assignments: [d('quiz-a', { familyId: 'fam-a', childId: 'kid-a' }), d('quiz-b', { familyId: 'fam-a', childId: 'kid-b' })],
      dayOwners: [],
    }
    const inventory = await createFirestoreSourceInventory(fakeDb(rows), { includeMesh: true,
      now: () => new Date('2026-10-17T03:00:00.000Z'), meshSource: { discoverGradeScopes: async (scope) => {
        if (scope.childId === 'kid-a') throw Object.assign(new Error('credentials_unavailable'), { code: 'credentials_unavailable' })
        return [{ ...scope, subjectId: 'math', periodKey: '2026-09-01' }]
      } } }).enumerate()
    expect(inventory.complete).toBe(false)
    expect(inventory.families).toEqual([{ familyId: 'fam-a' }])
    expect(inventory.scopes.filter((item) => item.source === 'firestore').map((item) => item.scope.quizToken).sort()).toEqual(['quiz-a', 'quiz-b'])
    expect(inventory.scopes.filter((item) => item.source === 'mesh').every((item) => item.scope.childId === 'kid-b')).toBe(true)
    expect(inventory.failedContexts).toContainEqual({ source: 'mesh', familyId: 'fam-a', childId: 'kid-a', sourceAccountId: accountId('actor-a') })

    const processed = []
    const sources = ['firestore', 'mesh'].map((kind) => ({ kind,
      scopeKey: (scope) => JSON.stringify(scope), subscribe: () => async () => {} }))
    const coordinator = new SourceCoordinator({ sources, pipelines: {
      firestore: { process: vi.fn(async (scope) => { processed.push(['firestore', scope.childId]); return { status: 'advanced' } }) },
      mesh: { process: vi.fn(async (scope) => { processed.push(['mesh', scope.childId, scope.kind]); return { status: 'advanced' } }) },
    }, enumerate: async () => inventory, reconcileMs: 60_000 })
    await coordinator.start()
    await vi.waitFor(() => expect(processed.length).toBe(inventory.scopes.length))
    expect(processed).toContainEqual(['firestore', 'kid-a'])
    expect(processed).toContainEqual(['firestore', 'kid-b'])
    expect(processed).toContainEqual(['mesh', 'kid-b', 'grades'])
    expect(processed.some(([source, childId]) => source === 'mesh' && childId === 'kid-a')).toBe(false)
    await coordinator.close()
  })
})
