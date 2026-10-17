import { describe, expect, it } from 'vitest'
import { createFamilyGraphRepository } from './family-graph.mjs'

const d = (id, data = {}) => ({ id, data })

function fakeDb(rows, failPath = null, { onGet = () => {}, calls = [] } = {}) {
  return { collection: (path) => query(path, [], null),
    doc: (path) => ({ id: path.split('/').at(-1), get: async () => ({ exists: false, data: () => undefined }) }) }
  function query(path, filters, cursor) {
    return {
      where(field, op, value) { return query(path, [...filters, { field, op, value }], cursor) },
      orderBy() { return query(path, filters, cursor) },
      startAfter(doc) { return query(path, filters, doc) },
      limit(size) { return { get: async () => {
        calls.push({ path, cursor: cursor?.id ?? null })
        onGet(path, cursor)
        if (failPath === path) throw Object.assign(new Error('unavailable'), { code: 'unavailable' })
        const all = (rows[path] ?? []).filter((row) => filters.every((filter) => row.data[filter.field] === filter.value))
          .sort((left, right) => left.id.localeCompare(right.id))
        const start = cursor ? all.findIndex((row) => row.id === cursor.id) + 1 : 0
        return { docs: all.slice(start, start + size).map((row) => ({ id: row.id, data: () => row.data })) }
      } } },
    }
  }
}

describe('shared family graph repository', () => {
  it('keyset-paginates every graph collection and preserves consumer filter choice', async () => {
    const db = fakeDb({ families: [d('f1'), d('f2', { active: false })],
      'families/f1/children': [d('c1'), d('c2', { active: false })],
      'families/f1/members': [d('p1'), d('p2')],
      sourceAccounts: [d('a1', { familyId: 'f1' }), d('a2', { familyId: 'f1' })],
      sourceIdentities: [d('i1', { familyId: 'f1' })],
      'families/f2/children': [d('c3')], 'families/f2/members': [],
    })
    const all = await createFamilyGraphRepository(db, { pageSize: 1 }).enumerate()
    expect(all.complete).toBe(true)
    expect(all.families).toHaveLength(2)
    expect(all.children).toHaveLength(3)
    expect(all.accounts).toHaveLength(2)
    expect(all.identities).toHaveLength(1)
    const active = await createFamilyGraphRepository(db, { pageSize: 1 }).enumerate({ includeInactiveFamilies: false, includeInactiveChildren: false })
    expect(active.families.map((item) => item.id)).toEqual(['f1'])
    expect(active.children.map((item) => item.id)).toEqual(['c1'])
  })

  it('retains healthy graph rows and marks a family partial on one page failure', async () => {
    const db = fakeDb({ families: [d('f1'), d('f2')],
      'families/f1/children': [d('c1')], 'families/f1/members': [],
      'families/f2/children': [d('c2')], 'families/f2/members': [],
    }, 'families/f1/children')
    const graph = await createFamilyGraphRepository(db, { pageSize: 1 }).enumerate()
    expect(graph.complete).toBe(false)
    expect(graph.failures).toContainEqual({ familyId: 'f1', source: 'children', code: 'unavailable' })
    expect(graph.families.map((item) => item.id)).toEqual(['f1', 'f2'])
    expect(graph.children.map((item) => item.id)).toEqual(['c2'])
  })

  it('does no Firestore reads when enumeration starts with an aborted signal', async () => {
    const calls = []
    const controller = new AbortController()
    controller.abort()
    const graph = createFamilyGraphRepository(fakeDb({ families: [d('f1')] }, null, { calls }))
    await expect(graph.enumerate({ signal: controller.signal })).rejects.toMatchObject({ code: 'worker_shutdown' })
    expect(calls).toEqual([])
  })

  it('awaits the current page and stops before requesting the next page after abort', async () => {
    const calls = []
    const controller = new AbortController()
    const db = fakeDb({ families: [d('f1')], 'families/f1/children': [d('c1'), d('c2')],
      'families/f1/members': [], sourceAccounts: [], sourceIdentities: [] }, null, {
      calls,
      onGet(path) { if (path === 'families/f1/children') controller.abort() },
    })
    const graph = createFamilyGraphRepository(db, { pageSize: 1 })
    await expect(graph.enumerate({ signal: controller.signal })).rejects.toMatchObject({ code: 'worker_shutdown' })
    expect(calls.filter(({ path }) => path === 'families/f1/children')).toHaveLength(1)
  })
})
