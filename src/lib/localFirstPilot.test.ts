import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { readLocalQuiz, writeLocalQuizDraft } from './quizLocalStore'
import { clearProjection, importLegacyDashboard, makePacket, makeSnapshot, readProjection, synchronizeProjection } from './localFirstPilot'
import type { Audience, Channel, ChannelSnapshot, DeltaSource, Entries, Head, Packet } from './localFirstPilot'

const family = 'fixture-family'
const epoch = 'fixture-epoch-1'
const key = (audience: Audience, channel: Channel, revision: number) => `${audience}/${channel}/${revision}`

class FakeFirestore implements DeltaSource {
  heads = new Map<Audience, Head>()
  packets = new Map<string, Packet>()
  snapshots = new Map<string, ChannelSnapshot>()
  reads: string[] = []
  legacyDocuments = new Map<string, unknown>()
  denied = new Set<Audience>()

  async getHead(familyId: string, audience: Audience) {
    this.reads.push(`head/${audience}`)
    if (this.denied.has(audience)) throw Object.assign(new Error('Access revoked'), { code: 'permission-denied' })
    const head = this.heads.get(audience)
    if (familyId !== family || !head) throw new Error('No fixture head')
    return structuredClone(head)
  }
  async getPacket(_familyId: string, audience: Audience, _epoch: string, channel: Channel, revision: number) {
    this.reads.push(`packet/${key(audience, channel, revision)}`)
    return structuredClone(this.packets.get(key(audience, channel, revision)) ?? null)
  }
  async getSnapshot(_familyId: string, audience: Audience, _epoch: string, channel: Channel, revision: number) {
    this.reads.push(`snapshot/${key(audience, channel, revision)}`)
    return structuredClone(this.snapshots.get(key(audience, channel, revision)) ?? null)
  }
  async seed(audience: Audience, channel: Channel, entries: Entries, revision = 1) {
    this.heads.set(audience, { schemaVersion: 2, familyId: family, audience, epoch,
      revisions: { ...this.heads.get(audience)?.revisions, [channel]: revision } })
    this.snapshots.set(key(audience, channel, revision), await makeSnapshot({ schemaVersion: 2,
      familyId: family, audience, epoch, channel, revision, entries }))
  }
  async publish(audience: Audience, channel: Channel, operations: Packet['operations']) {
    const previousRevision = this.heads.get(audience)!.revisions[channel]!
    const revision = previousRevision + 1
    const old = this.snapshots.get(key(audience, channel, previousRevision))!.entries
    const entries = structuredClone(old)
    for (const operation of operations) {
      if (operation.kind === 'put') entries[operation.key] = operation.value
      else delete entries[operation.key]
    }
    this.packets.set(key(audience, channel, revision), await makePacket({ schemaVersion: 2,
      familyId: family, audience, epoch, channel, previousRevision, revision, operations }))
    await this.seed(audience, channel, entries, revision)
  }
  readLegacyScene() {
    for (const [path] of this.legacyDocuments) this.reads.push(`legacy/${path}`)
    return [...this.legacyDocuments.values()]
  }
}

async function deletePilotDatabase() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('education-projection-pilot-v2')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

beforeEach(async () => { await deletePilotDatabase() })

describe('head → delta pilot against local Firestore and IndexedDB fakes', () => {
  it('reopens an unchanged multi-document scene with one head read and no body reads', async () => {
    const source = new FakeFirestore()
    await source.seed('parent:parent-1', 'calendar', { monday: { date: '2026-10-12' } })
    await source.seed('parent:parent-1', 'tasks', { biology: { text: '§ 5' } })
    for (let page = 1; page <= 8; page++) source.legacyDocuments.set(`bookPages/${page}`, { page })
    source.legacyDocuments.set('dayDashboards/parent', { date: '2026-10-12' })
    await synchronizeProjection(source, family, 'parent:parent-1')
    source.reads = []
    expect(await synchronizeProjection(source, family, 'parent:parent-1')).toEqual({ changed: [], status: 'unchanged' })
    expect(source.reads).toEqual(['head/parent:parent-1'])
    source.reads = []
    source.readLegacyScene()
    expect(source.reads).toHaveLength(9)
  })

  it('reads only the changed channel packet and leaves other channels untouched', async () => {
    const source = new FakeFirestore()
    await source.seed('student:child-1', 'calendar', { monday: { lesson: 'biology' } })
    await source.seed('student:child-1', 'tasks', { biology: { text: '§ 5' } })
    await synchronizeProjection(source, family, 'student:child-1')
    await source.publish('student:child-1', 'tasks', [{ kind: 'put', key: 'biology', value: { text: '§ 5, тетрадь' } }])
    source.reads = []
    expect(await synchronizeProjection(source, family, 'student:child-1')).toEqual({ changed: ['tasks'], status: 'updated' })
    expect(source.reads).toEqual(['head/student:child-1', 'packet/student:child-1/tasks/2'])
    expect((await readProjection(family, 'student:child-1'))?.channels).toEqual({
      calendar: { monday: { lesson: 'biology' } }, tasks: { biology: { text: '§ 5, тетрадь' } },
    })
  })

  it('keeps the old local draft and dashboard during additive v1 → v2 migration', async () => {
    const dashboard = { schemaVersion: 1, days: [{ date: '2026-10-12', homework: ['biology'] }] }
    await writeLocalQuizDraft('migration-quiz', { question1: 'Незаконченный ответ' })
    await importLegacyDashboard(family, 'student:child-1', dashboard)
    expect((await readProjection(family, 'student:child-1'))?.channels.calendar).toEqual({ dashboard })
    const source = new FakeFirestore()
    await source.seed('student:child-1', 'calendar', { monday: { date: '2026-10-12', homework: ['biology'] } })
    await synchronizeProjection(source, family, 'student:child-1')
    const migrated = await readProjection(family, 'student:child-1')
    expect(migrated?.epoch).toBe(epoch)
    expect(migrated?.legacyDashboard).toEqual(dashboard)
    expect((await readLocalQuiz('migration-quiz')).draft).toEqual({ question1: 'Незаконченный ответ' })
    await importLegacyDashboard(family, 'student:child-1', { days: [] })
    expect((await readProjection(family, 'student:child-1'))?.legacyDashboard).toEqual(dashboard)
  })

  it('recovers a missing delta from a complete channel snapshot', async () => {
    const source = new FakeFirestore()
    await source.seed('parent:parent-1', 'tasks', { task: { state: 'assigned' } })
    await synchronizeProjection(source, family, 'parent:parent-1')
    await source.publish('parent:parent-1', 'tasks', [{ kind: 'put', key: 'task', value: { state: 'reviewed' } }])
    await source.publish('parent:parent-1', 'tasks', [{ kind: 'put', key: 'task2', value: { state: 'assigned' } }])
    source.packets.delete(key('parent:parent-1', 'tasks', 2))
    source.reads = []
    await synchronizeProjection(source, family, 'parent:parent-1')
    expect(source.reads).toEqual(['head/parent:parent-1', 'packet/parent:parent-1/tasks/2', 'snapshot/parent:parent-1/tasks/3'])
    expect((await readProjection(family, 'parent:parent-1'))?.channels.tasks).toEqual({
      task: { state: 'reviewed' }, task2: { state: 'assigned' },
    })
  })

  it('rejects a corrupt packet without partially applying another channel', async () => {
    const source = new FakeFirestore()
    await source.seed('parent:parent-1', 'calendar', { monday: { lesson: 'biology' } })
    await source.seed('parent:parent-1', 'tasks', { task: { state: 'assigned' } })
    await synchronizeProjection(source, family, 'parent:parent-1')
    const before = await readProjection(family, 'parent:parent-1')
    await source.publish('parent:parent-1', 'calendar', [{ kind: 'put', key: 'tuesday', value: { lesson: 'math' } }])
    await source.publish('parent:parent-1', 'tasks', [{ kind: 'put', key: 'task', value: { state: 'reviewed' } }])
    source.packets.get(key('parent:parent-1', 'tasks', 2))!.operations[0] = { kind: 'delete', key: 'task' }
    source.snapshots.delete(key('parent:parent-1', 'tasks', 2))
    await expect(synchronizeProjection(source, family, 'parent:parent-1')).rejects.toThrow('Нет целостного снимка')
    expect(await readProjection(family, 'parent:parent-1')).toEqual(before)
  })

  it('rejects hostile keys and a packet for the wrong role before local commit', async () => {
    const source = new FakeFirestore()
    await source.seed('student:child-1', 'tasks', { task: { text: 'read' } })
    await synchronizeProjection(source, family, 'student:child-1')
    const before = await readProjection(family, 'student:child-1')
    await source.publish('student:child-1', 'tasks', [{ kind: 'put', key: 'task2', value: { text: 'write' } }])
    source.packets.get(key('student:child-1', 'tasks', 2))!.operations[0] = { kind: 'put', key: '__proto__', value: { hidden: true } }
    source.snapshots.delete(key('student:child-1', 'tasks', 2))
    await expect(synchronizeProjection(source, family, 'student:child-1')).rejects.toThrow('Нет целостного снимка')
    expect(await readProjection(family, 'student:child-1')).toEqual(before)
    source.packets.get(key('student:child-1', 'tasks', 2))!.audience = 'parent:parent-1'
    await expect(synchronizeProjection(source, family, 'student:child-1')).rejects.toThrow('Нет целостного снимка')
    expect(await readProjection(family, 'student:child-1')).toEqual(before)
  })

  it('separates roles and hides the revoked role without deleting the other one', async () => {
    const source = new FakeFirestore()
    await source.seed('parent:parent-1', 'reviews', { task: { answer: 'parent only' } })
    await source.seed('student:child-1', 'tasks', { task: { instruction: 'read' } })
    await source.seed('student:child-2', 'tasks', { siblingTask: { instruction: 'write' } })
    await synchronizeProjection(source, family, 'parent:parent-1')
    await synchronizeProjection(source, family, 'student:child-1')
    await synchronizeProjection(source, family, 'student:child-2')
    expect(JSON.stringify(await readProjection(family, 'student:child-1'))).not.toContain('parent only')
    expect(JSON.stringify(await readProjection(family, 'student:child-1'))).not.toContain('siblingTask')
    source.denied.add('student:child-1')
    expect(await synchronizeProjection(source, family, 'student:child-1')).toEqual({ changed: [], status: 'revoked' })
    expect(await readProjection(family, 'student:child-1')).toBeNull()
    expect((await readProjection(family, 'student:child-2'))?.channels.tasks).toEqual({ siblingTask: { instruction: 'write' } })
    expect((await readProjection(family, 'parent:parent-1'))?.channels.reviews).toEqual({ task: { answer: 'parent only' } })
    await clearProjection(family, 'parent:parent-1')
  })

  it('does not claim a win for a one-document calendar-only route', async () => {
    const source = new FakeFirestore()
    await source.seed('parent:parent-1', 'calendar', { dashboard: { day: '2026-10-12' } })
    await synchronizeProjection(source, family, 'parent:parent-1')
    source.reads = []
    await synchronizeProjection(source, family, 'parent:parent-1')
    expect(source.reads).toHaveLength(1) // current dashboard listener also initially reads one document
    await source.publish('parent:parent-1', 'calendar', [{ kind: 'put', key: 'dashboard', value: { day: '2026-10-13' } }])
    source.reads = []
    await synchronizeProjection(source, family, 'parent:parent-1')
    expect(source.reads).toHaveLength(2) // head + packet versus one changed dashboard document
  })
})
