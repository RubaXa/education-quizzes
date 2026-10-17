import { describe, expect, it } from 'vitest'
import { createMeshSourceAdapter, meshScopeKey, normalizeMeshObservation } from './source-mesh.mjs'
import { diffCompleteSnapshots } from '../domain/diff.mjs'

/** @see ../../../docs/services/telegram-bot/adapters/mesh.md#контракт-снимка @see ../../../docs/services/telegram-bot/adapters/mesh.md#начальный-event-mapping */

const scope = { source: 'mesh', familyId: 'f1', childId: 'c1', sourceAccountId: 'a'.repeat(64), sourcePersonId: 'mesh-child', kind: 'schedule', date: '2026-10-17' }
const lesson = (extra = {}) => ({ id: 7, start_at: '2026-10-17T09:00:00+03:00', finish_at: '2026-10-17T09:45:00+03:00', subject_id: 4, subject_name: 'Математика', cancelled: false, replaced: false, ...extra })
const assignment = (extra = {}) => ({ sourceItemId: '7', lessonDate: '2026-10-17', subjectName: 'Математика', descriptions: ['Решить задачу'], homeworkEntries: [{ id: 'hw-1', description: '№ 5', updatedAt: null }], teacherFiles: [{ id: 'file-1', title: 'лист', url: 'https://school.mos.ru/private' }], detailStatus: 'loaded', ...extra })
function project({ schedule = [lesson()], assignments = [assignment()], marks = [], s = scope } = {}) {
  return normalizeMeshObservation({ scope: s, schedule, assignments, marks, observedAt: '2026-10-17T12:00:00.000Z' })
}

describe('Mesh safe source projection', () => {
  it('uses stable shard scopes, independent of rolling date windows', () => {
    expect(meshScopeKey(scope)).toMatch(/^[a-f0-9]{64}$/)
    expect(meshScopeKey({ ...scope, date: '2026-10-18' })).not.toBe(meshScopeKey(scope))
    expect(meshScopeKey({ ...scope, sourceAccountId: 'b'.repeat(64) })).not.toBe(meshScopeKey(scope))
    expect(meshScopeKey({ ...scope, kind: 'grades', subjectId: '4', periodKey: '2026-09-01' })).not.toBe(meshScopeKey(scope))
  })

  it('projects only safe fields and hashes complete lesson/homework semantics', () => {
    const result = project()
    expect(result.completeness).toBe('complete')
    expect(result.records).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('school.mos.ru')
    expect(result.records.every((record) => /^[a-f0-9]{64}$/.test(record.semanticHash))).toBe(true)
  })

  it('uses verified child name and Moscow lesson times in the schedule title', () => {
    const result = normalizeMeshObservation({ scope, schedule: [lesson()], childName: 'Ученик А', observedAt: '2026-10-17T12:00:00Z' })
    expect(result.records[0].fields.childName).toBe('Ученик А')
    expect(result.records[0].fields.title).toBe('Математика · 09:00–09:45')
  })

  it('detects lesson end-time and teacher attachment identity changes', () => {
    const base = project().records
    expect(project({ schedule: [lesson({ finish_at: '2026-10-17T10:00:00+03:00' })] }).records[0].semanticHash).not.toBe(base[0].semanticHash)
    const homeworkScope = { ...scope, kind: 'homework' }
    const before = project({ s: homeworkScope })
    const after = project({ s: homeworkScope, assignments: [assignment({ teacherFiles: [{ id: 'file-2', title: 'same title', url: 'https://school.mos.ru/x' }] })] })
    expect(before.records[0].semanticHash).not.toBe(after.records[0].semanticHash)
    const diff = diffCompleteSnapshots({ source: 'mesh', scopeKey: before.scopeKey, familyId: 'f1', childId: 'c1',
      previous: { complete: true, observationSequence: 1, records: before.records }, current: { complete: true, observationSequence: 2, records: after.records }, detectedAt: '2026-10-17T13:00:00Z' })
    expect(diff.events).toHaveLength(1)
  })

  it('keeps homework changes out of the schedule record digest', () => {
    const a = project({ schedule: [lesson({ homework: { descriptions: ['a'] } })], assignments: [] })
    const b = project({ schedule: [lesson({ homework: { descriptions: ['b'] } })], assignments: [] })
    expect(a.records[0].semanticHash).toBe(b.records[0].semanticHash)
  })

  it('ignores order-only changes in homework fields', () => {
    const a = assignment({ descriptions: ['second', 'first'], homeworkEntries: [{ id: 'hw-2', description: '2' }, { id: 'hw-1', description: '1' }], teacherFiles: [{ id: 'f2' }, { id: 'f1' }] })
    const b = assignment({ descriptions: ['first', 'second'], homeworkEntries: [{ id: 'hw-1', description: '1' }, { id: 'hw-2', description: '2' }], teacherFiles: [{ id: 'f1' }, { id: 'f2' }] })
    const homeworkScope = { ...scope, kind: 'homework' }
    expect(project({ s: homeworkScope, assignments: [a] }).records[0].semanticHash).toBe(project({ s: homeworkScope, assignments: [b] }).records[0].semanticHash)
  })

  it('ignores positional entry IDs while hashing full text beyond display limit', () => {
    const homeworkScope = { ...scope, kind: 'homework' }
    const text = 'a'.repeat(520)
    const base = project({ s: homeworkScope, assignments: [assignment({ homeworkEntries: [{ id: '7-0', description: text }] })] }).records[0]
    const changed = project({ s: homeworkScope, assignments: [assignment({ homeworkEntries: [{ id: '7-0', description: `${text} changed` }] })] }).records[0]
    expect(base.semanticHash).not.toBe(changed.semanticHash)
    expect(base.fields.title.length).toBe(500)
    const observation = project({ s: homeworkScope, assignments: [assignment({ homeworkEntries: [{ id: '7-0', description: text }] })] })
    const changedObservation = project({ s: homeworkScope, assignments: [assignment({ homeworkEntries: [{ id: '7-0', description: `${text} changed` }] })] })
    const previous = { complete: true, observationSequence: 1, records: observation.records }
    const current = { complete: true, observationSequence: 2, records: changedObservation.records }
    expect(diffCompleteSnapshots({ source: 'mesh', scopeKey: observation.scopeKey, familyId: 'f1', childId: 'c1', previous, current, detectedAt: '2026-10-17T13:00:00Z' }).events).toHaveLength(1)
  })

  it('produces no event for shuffled entries with the same semantic content', () => {
    const homeworkScope = { ...scope, kind: 'homework' }
    const old = project({ s: homeworkScope, assignments: [assignment({ descriptions: ['a', 'b'], homeworkEntries: [{ id: '7-0', description: 'x' }, { id: '7-1', description: 'y' }], teacherFiles: [{ id: 'f2' }, { id: 'f1' }] })] })
    const current = project({ s: homeworkScope, assignments: [assignment({ descriptions: ['b', 'a'], homeworkEntries: [{ id: '7-1', description: 'y' }, { id: '7-0', description: 'x' }], teacherFiles: [{ id: 'f1' }, { id: 'f2' }] })] })
    const result = diffCompleteSnapshots({ source: 'mesh', scopeKey: old.scopeKey, familyId: 'f1', childId: 'c1',
      previous: { complete: true, observationSequence: 1, records: old.records }, current: { complete: true, observationSequence: 2, records: current.records }, detectedAt: '2026-10-17T13:00:00Z' })
    expect(result.events).toHaveLength(0)
  })

  it('rejects incomplete homework details and malformed schedule times', () => {
    expect(project({ s: { ...scope, kind: 'homework' }, assignments: [assignment({ detailStatus: 'stale' })] })).toBeNull()
    expect(project({ schedule: [lesson({ finish_at: 'unreadable' })], assignments: [] })).toBeNull()
  })

  it('emits individual grades only when stable IDs and full counts are present', () => {
    const marksScope = { ...scope, kind: 'grades', subjectId: '4', periodKey: '2026-09-01' }
    const marks = [{ subject_id: 4, subject_name: 'Математика', start: '2026-09-01', count: 1, marks: [{ id: 12, value: '5', date: '2026-10-13', weight: 1, comment: 'private' }] }]
    const result = project({ s: marksScope, marks })
    expect(result.records).toHaveLength(1)
    expect(result.records[0].fields.value).toBe('5')
    expect(JSON.stringify(result)).not.toContain('private')
    expect(project({ s: marksScope, marks: [{ ...marks[0], marks: [{ value: '5' }] }] })).toBeNull()
    expect(project({ s: marksScope, marks: [{ ...marks[0], count: 2 }] })).toBeNull()
    expect(project({ s: marksScope, marks: [{ ...marks[0], marks: [{ id: 12, value: '6' }] }] })).toBeNull()
    expect(project({ s: marksScope, marks: [{ ...marks[0], start: '2026-11-23' }] }).records).toHaveLength(0)
  })

  it('rejects incomplete current source arrays and invalid semantic digests without advancing', () => {
    expect(normalizeMeshObservation({ scope, observedAt: '2026-10-17T12:00:00Z' })).toBeNull()
    const current = project()
    current.records[0].semanticHash = 'not-a-sha'
    const result = diffCompleteSnapshots({ source: 'mesh', scopeKey: current.scopeKey, familyId: 'f1', childId: 'c1',
      previous: null, current: { complete: true, observationSequence: 1, records: current.records }, detectedAt: '2026-10-17T13:00:00Z' })
    expect(result.advanced).toBe(false)
  })

  it('provides the source port, polls only its supplied scopes, and drains on stop', async () => {
    let callback, reads = 0, signalled = 0
    const source = createMeshSourceAdapter({ resolver: { async validateScope() { return true }, async withChildAdapter(_scope, run) {
      reads += 1
      return run({ async getSchedule(date) { return [lesson({ start_at: `${date}T09:00:00Z`, finish_at: `${date}T09:45:00Z` })] } }, { childName: 'Ученик А' })
    } }, pollMs: 1000, jitterMs: 0, setTimer(fn) { callback = fn; return 1 }, clearTimer() {} })
    expect(source.kind).toBe('mesh')
    expect(await source.validateScope(scope)).toBe(true)
    const observed = await source.observe(scope)
    expect(observed.records).toHaveLength(1)
    expect(observed.records[0].fields.childName).toBe('Ученик А')
    expect(observed.records[0].fields.title).toBe('Математика · 12:00–12:45')
    expect(reads).toBe(1)
    const stop = source.subscribe({ scopes: [scope], onSignal() { signalled += 1 } })
    const poll = callback
    poll()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(signalled).toBe(1)
    await stop()
    callback?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(signalled).toBe(1)
  })

  it('reports credential failures only with a hashed source scope key', async () => {
    let health
    const source = createMeshSourceAdapter({ resolver: { async validateScope() { return true }, async withChildAdapter() { const error = new Error('secret message'); error.code = 'credentials_unavailable'; throw error } },
      onHealth(event) { health = event } })
    const observation = await source.observe(scope)
    expect(observation.completeness).toBe('partial')
    expect(observation.errorCode).toBe('credentials_unavailable')
    expect(health).toEqual({ source: 'mesh', scopeKey: meshScopeKey(scope), code: 'credentials_unavailable' })
    expect(JSON.stringify(health)).not.toContain('f1')
  })

  it('discovers actual subject-period grade shards from Mesh and caches until poll interval', async () => {
    let reads = 0
    const marks = [
      { subject_id: 4, start: '2026-09-01', subject_name: 'Математика', count: 1, marks: [{ id: 1, value: '5' }] },
      { subject_id: 8, start: '2026-09-01', subject_name: 'Русский', count: 1, marks: [{ id: 2, value: '4' }] },
    ]
    const base = { source: 'mesh', familyId: 'f1', childId: 'c1', sourceAccountId: 'a'.repeat(64), sourcePersonId: 'mesh-child', kind: 'grades' }
    const source = createMeshSourceAdapter({ resolver: { async validateScope() { return true }, async withChildAdapter(_scope, run) {
      return run({ async getMarks() { reads += 1; return marks } })
    } }, pollMs: 60_000, now: () => new Date('2026-10-17T12:00:00Z') })
    const first = await source.discoverGradeScopes(base)
    const second = await source.discoverGradeScopes(base)
    const observed = await Promise.all(first.map((scope) => source.observe(scope)))
    expect(first.map(({ subjectId, periodKey }) => [subjectId, periodKey])).toEqual([['4', '2026-09-01'], ['8', '2026-09-01']])
    expect(second).toEqual(first)
    expect(observed.map((item) => item.records.length)).toEqual([1, 1])
    expect(reads).toBe(1)
  })

  it('sweeps expired child grade projections lazily on a later child fetch', async () => {
    let reads = 0, clock = Date.parse('2026-10-17T12:00:00Z')
    const marks = [{ subject_id: 4, start: '2026-09-01', subject_name: 'Математика', count: 1, marks: [{ id: 1, value: '5' }] }]
    const base = { source: 'mesh', familyId: 'f1', childId: 'c1', sourceAccountId: 'a'.repeat(64), sourcePersonId: 'mesh-child', kind: 'grades' }
    const otherChild = { ...base, childId: 'c2', sourcePersonId: 'mesh-child-2' }
    const projectionCache = new Map()
    const source = createMeshSourceAdapter({ projectionCache, resolver: { async validateScope() { return true }, async withChildAdapter(_scope, run) {
      return run({ async getMarks() { reads += 1; return marks } }, { childName: 'Ученик А' })
    } }, now: () => new Date(clock) })
    await source.discoverGradeScopes(base)
    const c1CacheKey = [...projectionCache.keys()][0]
    expect(projectionCache.size).toBe(1)
    clock += 60_001
    await source.discoverGradeScopes(otherChild)
    expect(projectionCache.size).toBe(1)
    expect(projectionCache.has(c1CacheKey)).toBe(false)
    await source.discoverGradeScopes(base)
    expect(reads).toBe(3)
  })
})
