import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEducationFirestore, instrumentFirestoreClient, prepareLocalApplicationCredentials } from './firestore.mjs'
import { createFamilyGraphRepository } from './family-graph.mjs'
import { createTelemetry } from './telemetry.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const root = () => { const path = mkdtempSync(join(tmpdir(), 'education-adc-test-')); roots.push(path); return path }

describe('shared Firestore and ADC factory', () => {
  it('validates local authorized-user ADC and service account formats', () => {
    const cwd = root(), file = join(cwd, 'adc.json')
    const env = { GOOGLE_APPLICATION_CREDENTIALS: 'adc.json' }
    writeFileSync(file, JSON.stringify({ type: 'authorized_user', client_id: 'id', client_secret: 'secret', refresh_token: 'refresh' }))
    expect(prepareLocalApplicationCredentials({ cwd, env })).toBe(file)
    writeFileSync(file, JSON.stringify({ type: 'service_account', project_id: 'p', client_email: 'svc@example.test', private_key: 'key' }))
    expect(prepareLocalApplicationCredentials({ cwd, env })).toBe(file)
    writeFileSync(file, JSON.stringify({ type: 'unknown' }))
    expect(() => prepareLocalApplicationCredentials({ cwd, env })).toThrow(/неподдерживаемый формат/)
  })

  it('resolves an existing local ADC file without logging or returning credential content', () => {
    const cwd = root(), adcFile = join(cwd, '.local', 'adc.json')
    mkdirSync(join(cwd, '.local'), { recursive: true })
    writeFileSync(adcFile, JSON.stringify({ type: 'authorized_user', client_id: 'id', client_secret: 'secret', refresh_token: 'refresh' }))
    const env = {}
    expect(prepareLocalApplicationCredentials({ cwd, env })).toBe(adcFile)
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe(adcFile)
    expect(JSON.stringify(env)).not.toContain('refresh')
  })

  it('constructs the production Firestore SDK with an explicit project and local ADC file', () => {
    const instances = []
    class TestFirestore { constructor(options) { this.options = options; instances.push(this) } }
    const prepareCredentials = vi.fn()
    prepareCredentials.mockReturnValue('/tmp/adc.json')
    const first = createEducationFirestore({ projectId: 'test-project', FirestoreClass: TestFirestore, prepareCredentials })
    expect(first.options).toEqual({ projectId: 'test-project', keyFilename: '/tmp/adc.json' })
    expect(instances).toHaveLength(1)
    createEducationFirestore({ projectId: 'test-project', FirestoreClass: TestFirestore, prepareCredentials })
    expect(instances).toHaveLength(2)
    expect(prepareCredentials).toHaveBeenCalledTimes(2)
  })

  it('uses ambient ADC without overriding a missing local key filename', () => {
    class TestFirestore { constructor(options) { this.options = options } }
    const client = createEducationFirestore({ projectId: 'test-project', FirestoreClass: TestFirestore, prepareCredentials: () => null })
    expect(client.options).toEqual({ projectId: 'test-project' })
  })

  it('instruments reads, writes, transactions, and listener snapshots without exposing paths', async () => {
    const telemetry = createTelemetry()
    const seen = []
    class FakeFirestore {
      constructor() { this.calls = [] }
      doc(path) {
        const owner = this
        return { async get() { owner.calls.push(['document.get', path]); return { exists: true, data: () => ({}) } },
          async set() { owner.calls.push(['document.set', path]) } }
      }
      collection(path) {
        const owner = this
        const query = { where() { owner.calls.push(['where', path]); return query }, limit() { owner.calls.push(['limit', path]); return query },
          async get() { owner.calls.push(['query.get', path]); return { docs: [{ id: 'synthetic' }] } },
          onSnapshot(callback) { owner.calls.push(['onSnapshot', path]); callback({ docs: [{ id: 'synthetic' }] }); return () => {} } }
        return query
      }
      async getAll(...refs) { this.calls.push(['getAll', refs.length]); return refs.map(() => ({ exists: true })) }
      async runTransaction(callback) { this.calls.push(['runTransaction']); return callback({ async get() { return { exists: true } }, set() {} }) }
    }
    const db = instrumentFirestoreClient(new FakeFirestore(), telemetry)
    await db.collection('private/family').where('familyId', '==', 'sensitive-id').limit(3).get()
    await db.doc('private/child').get()
    await db.doc('private/child').set({ privatePayload: true })
    await db.getAll(db.doc('a'), db.doc('b'))
    await db.runTransaction(async (transaction) => transaction.get(db.doc('c')))
    let unsubscribe
    unsubscribe = db.collection('private/listener').onSnapshot(() => {})
    expect(typeof unsubscribe).toBe('function')
    expect(db.calls.map(([name]) => name)).toContain('query.get')
    expect(db.calls.map(([name]) => name)).toContain('document.set')
    expect(db.calls.map(([name]) => name)).toContain('runTransaction')
    const snapshot = telemetry.snapshot()
    expect(snapshot.spans['firestore.query.read'].count).toBeGreaterThanOrEqual(2)
    expect(snapshot.spans['firestore.document.read'].count).toBe(1)
    expect(snapshot.spans['firestore.transaction'].count).toBe(1)
    expect(snapshot.counters['firestore.documents.returned']).toBeGreaterThanOrEqual(6)
    seen.push(JSON.stringify(snapshot))
    expect(seen.join('')).not.toContain('private/')
    expect(seen.join('')).not.toContain('sensitive-id')
    expect(seen.join('')).not.toContain('privatePayload')
  })

  it('counts returned Firestore documents once while family graph projection has separate counters', async () => {
    const telemetry = createTelemetry()
    const rows = {
      families: [{ id: 'family-a', data: { active: true } }],
      'families/family-a/children': [{ id: 'child-a', data: { active: true } }],
      'families/family-a/members': [{ id: 'parent-a', data: { active: true, role: 'parent' } }],
      sourceAccounts: [{ id: 'account-a', data: { familyId: 'family-a' } }],
      sourceIdentities: [{ id: 'identity-a', data: { familyId: 'family-a' } }],
    }
    class FakeFirestore {
      collection(path) {
        const state = { path, filters: [] }
        const query = {
          where(field, operator, value) { state.filters.push([field, operator, value]); return query },
          orderBy() { return query }, startAfter() { return query }, limit() { return query },
          async get() {
            const docs = (rows[state.path] ?? []).filter((row) => state.filters.every(([field, operator, value]) =>
              operator === '==' && row.data[field] === value))
            return { docs: docs.map((row) => ({ id: row.id, data: () => row.data })) }
          },
        }
        return query
      }
    }
    const db = instrumentFirestoreClient(new FakeFirestore(), telemetry)
    const graph = await createFamilyGraphRepository(db, { telemetry }).enumerate()
    const snapshot = telemetry.snapshot()
    const returned = 5
    expect(graph.complete).toBe(true)
    expect(graph.families.length + graph.children.length + graph.members.length
      + graph.accounts.length + graph.identities.length).toBe(returned)
    expect(snapshot.counters['firestore.documents.returned']).toBe(returned)
    expect(snapshot.counters['firestore.graph.documents.projected']).toBe(returned)
    expect(snapshot.counters['firestore.graph.query.pages']).toBe(5)
    expect(snapshot.counters['firestore.documents.returned']).not.toBe(2 * returned)
  })
})
