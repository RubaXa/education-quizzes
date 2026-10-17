import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, renameSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMeshCredentialResolver } from './mesh-credentials.mjs'

/** @see ../../../docs/services/telegram-bot/adapters/mesh.md#автоматическая-семейная-адресация */

const hash = (value) => createHash('sha256').update(value).digest('hex')
const actor = 'adult-mesh-id'
const accountId = hash(`mesh-parent:${actor}`)
const sourcePersonId = 'child-mesh-id'
const identityId = hash(`mesh-child:${sourcePersonId}`)
let roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture({ failWrite = false, verifyDelay = 0, track = null, noRefreshToken = false, refreshOnProfileLookup = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mesh-resolver-test-'))
  roots.push(root)
  const connectionsDir = join(root, 'mesh-connections')
  mkdirSync(connectionsDir)
  const credentials = { actorPersonId: actor, token: 'old', profileId: 'previous-profile', studentId: 'previous-profile', extra: 'keep' }
  if (!noRefreshToken) credentials.refreshToken = 'refresh'
  const record = { schemaVersion: 1, source: 'mesh', keep: 'wrapper', credentials }
  const file = join(connectionsDir, `${accountId}.json`)
  writeFileSync(file, JSON.stringify(record), { mode: 0o600 })
  const values = new Map([
    ['families/f1', {}],
    ['families/f1/children/c1', { meshPersonId: sourcePersonId }],
    ['sourceAccounts/' + accountId, { source: 'mesh', sourcePersonId: actor, familyId: 'f1', personId: 'parent-internal' }],
    ['sourceIdentities/' + identityId, { source: 'mesh', sourcePersonId, familyId: 'f1', childId: 'c1' }],
    ['families/f1/members/parent-internal', { active: true, role: 'parent', childIds: ['c1'] }],
  ])
  const db = { doc(path) { return { id: path.split('/').at(-1), async get() { const value = values.get(path); return { id: this.id, exists: value !== undefined, data: () => value } } } } }
  const fs = {
    readFileSync,
    writeFileSync(...args) { if (failWrite) throw new Error('disk fail'); return writeFileSync(...args) },
    chmodSync,
    renameSync,
    unlinkSync,
  }
  const adapterFactory = (credentials, save) => ({
    secret: credentials,
    api: { async getStudentProfiles(person) {
      expect(person).toBe(actor)
      if (refreshOnProfileLookup && credentials.profileId === 'previous-profile') save({ ...credentials, token: 'profile-rotated', refreshToken: 'profile-refresh' })
      return [{ id: 'child-profile', person_id: sourcePersonId }, { id: 'child-profile-2', person_id: 'child-2' }]
    } },
    async verifyAccess() {
      expect(credentials.profileId).toBe(credentials.personId === sourcePersonId ? 'child-profile' : 'child-profile-2')
      if (track) { track.active += 1; track.max = Math.max(track.max, track.active) }
      if (verifyDelay) await new Promise((resolve) => setTimeout(resolve, verifyDelay))
      save({ ...credentials, token: 'rotated', ...(credentials.refreshToken !== undefined ? { refreshToken: 'new-refresh' } : {}), profileId: 'mutated-child-profile', studentId: 'mutated-child-profile' })
      if (track) track.active -= 1
    },
  })
  const resolver = createMeshCredentialResolver({ db, connectionsDir, fs, adapterFactory })
  return { resolver, file, values, connectionsDir }
}

const scope = { source: 'mesh', familyId: 'f1', childId: 'c1', sourceAccountId: accountId, sourcePersonId }
describe('Mesh credential scope resolver', () => {
  it('validates authoritative family, child identity and internal active parent membership', async () => {
    const { resolver } = fixture()
    expect(await resolver.validateScope(scope)).toBe(true)
    expect(await resolver.validateScope({ ...scope, familyId: 'wrong' })).toBe(false)
  })

  it('uses shared account credentials only to create a fresh child adapter and persists tokens without child profile overwrite', async () => {
    const { resolver, file } = fixture()
    await resolver.withChildAdapter(scope, async () => 'ok')
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.keep).toBe('wrapper')
    expect(saved.credentials.token).toBe('rotated')
    expect(saved.credentials.refreshToken).toBe('new-refresh')
    expect(saved.credentials.profileId).toBe('previous-profile')
    expect(saved.credentials.studentId).toBe('previous-profile')
  })

  it('fails the observation when atomic refresh persistence fails', async () => {
    const { resolver } = fixture({ failWrite: true })
    await expect(resolver.withChildAdapter(scope, async () => 'must-not-run')).rejects.toMatchObject({ code: 'credential_refresh_persist_failed' })
  })

  it('rejects a source account rebound to another Mesh actor', async () => {
    const { resolver, values } = fixture()
    values.set(`sourceAccounts/${accountId}`, { source: 'mesh', sourcePersonId: 'different-actor', familyId: 'f1', personId: 'parent-internal' })
    expect(await resolver.validateScope(scope)).toBe(false)
    await expect(resolver.withChildAdapter(scope, async () => 'bad')).rejects.toMatchObject({ code: 'scope_unavailable' })
  })

  it('accepts credential records without refreshToken and preserves that shape', async () => {
    const { resolver, file } = fixture({ noRefreshToken: true })
    await resolver.withChildAdapter(scope, async () => 'ok')
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.credentials.token).toBe('rotated')
    expect(saved.credentials).not.toHaveProperty('refreshToken')
  })

  it('uses a refresh completed during profile lookup for the child adapter', async () => {
    const { resolver, file } = fixture({ refreshOnProfileLookup: true })
    let childToken
    await resolver.withChildAdapter(scope, async (adapter) => { childToken = adapter.secret.token })
    expect(childToken).toBe('profile-rotated')
    expect(JSON.parse(readFileSync(file, 'utf8')).credentials.token).toBe('rotated')
  })

  it('serializes the complete shared-account lifecycle across children', async () => {
    const track = { active: 0, max: 0 }
    const { resolver, values } = fixture({ verifyDelay: 15, track })
    values.set('families/f1/children/c2', { meshPersonId: 'child-2' })
    values.set(`sourceIdentities/${hash('mesh-child:child-2')}`, { source: 'mesh', sourcePersonId: 'child-2', familyId: 'f1', childId: 'c2' })
    values.set('families/f1/members/parent-internal', { active: true, role: 'parent', childIds: ['c1', 'c2'] })
    await Promise.all([
      resolver.withChildAdapter(scope, async () => new Promise((resolve) => setTimeout(resolve, 10))),
      resolver.withChildAdapter({ ...scope, childId: 'c2', sourcePersonId: 'child-2' }, async () => 'done'),
    ])
    expect(track.max).toBe(1)
  })

  it('rejects revoked membership before touching Mesh', async () => {
    const { resolver, values } = fixture()
    values.set('families/f1/members/parent-internal', { active: false, role: 'parent', childIds: ['c1'] })
    await expect(resolver.withChildAdapter(scope, async () => 'bad')).rejects.toMatchObject({ code: 'scope_unavailable' })
  })

  it('rejects a deactivated family or child during active scope revalidation', async () => {
    const { resolver, values } = fixture()
    values.set('families/f1', { active: false })
    expect(await resolver.validateScope(scope)).toBe(false)
    values.set('families/f1', {})
    values.set('families/f1/children/c1', { meshPersonId: sourcePersonId, active: false })
    expect(await resolver.validateScope(scope)).toBe(false)
  })
})
