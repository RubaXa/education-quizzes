import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, chmodSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MeshDiaryAdapter } from '../../education-connect/lib/mesh.mjs'

/** @see ../../../docs/services/telegram-bot/adapters/mesh.md#автоматическая-семейная-адресация */
/** Resolves an exact internal inventory descriptor; credentials never leave this adapter. */
export function createMeshCredentialResolver({ db, connectionsDir, fs = defaultFs, adapterFactory = (credentials, save) => new MeshDiaryAdapter(credentials, save) }) {
  const locks = new Map()

  async function scopeContext(scope) {
    if (!validScope(scope)) return null
    try {
      const [family, child, account, identity] = await Promise.all([
        db.doc(`families/${scope.familyId}`).get(),
        db.doc(`families/${scope.familyId}/children/${scope.childId}`).get(),
        db.doc(`sourceAccounts/${scope.sourceAccountId}`).get(),
        db.doc(`sourceIdentities/${sourceIdentityId(scope.sourcePersonId)}`).get(),
      ])
      if (![family, child, account, identity].every((snap) => snap.exists)) return null
      const familyData = family.data(), childData = child.data(), accountData = account.data(), identityData = identity.data()
      if (familyData.active === false || childData.active === false || childData.meshPersonId !== scope.sourcePersonId
        || identityData.source !== 'mesh' || identityData.familyId !== scope.familyId || identityData.childId !== scope.childId
        || identityData.sourcePersonId !== scope.sourcePersonId
        || accountData.source !== 'mesh' || accountData.familyId !== scope.familyId || accountData.disconnectedAt
        || !validId(accountData.personId) || !validId(accountData.sourcePersonId)
        || parentAccountId(accountData.sourcePersonId) !== scope.sourceAccountId) return null
      const member = await db.doc(`families/${scope.familyId}/members/${accountData.personId}`).get()
      const memberData = member.exists ? member.data() : null
      if (memberData?.active !== true || memberData.role !== 'parent' || !Array.isArray(memberData.childIds) || !memberData.childIds.includes(scope.childId)) return null
      return { childName: safeLabel(childData.displayName) }
    } catch { return null }
  }
  async function validateScope(scope) { return Boolean(await scopeContext(scope)) }

  async function withChildAdapter(scope, run) {
    if (typeof run !== 'function' || !validScope(scope)) throw safeError('invalid_scope')
    return serialize(scope.sourceAccountId, async () => {
      const initialContext = await scopeContext(scope)
      if (!initialContext) throw safeError('scope_unavailable')
      const file = join(connectionsDir, `${scope.sourceAccountId}.json`)
      let record
      try { record = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { throw safeError('credentials_unavailable') }
      let shared = record?.credentials
      if (!shared || typeof shared.actorPersonId !== 'string' || parentAccountId(shared.actorPersonId) !== scope.sourceAccountId) throw safeError('credentials_mismatch')
      const account = await db.doc(`sourceAccounts/${scope.sourceAccountId}`).get()
      if (!account.exists || account.data().sourcePersonId !== shared.actorPersonId) throw safeError('credentials_mismatch')
      const accountAdapter = adapterFactory({ ...shared }, (updated) => persistTokens(file, record, updated, fs))
      let profiles
      try { profiles = await accountAdapter.api.getStudentProfiles(shared.actorPersonId) } catch { throw safeError('mesh_unavailable') }
      shared = record.credentials
      const selected = Array.isArray(profiles) ? profiles.find((profile) => String(profile.person_id) === scope.sourcePersonId) : null
      if (!selected?.id) throw safeError('child_profile_unavailable')
      const childCredentials = { ...shared, personId: String(selected.person_id), profileId: String(selected.id), studentId: String(selected.id) }
      const childAdapter = adapterFactory(childCredentials, (updated) => persistTokens(file, record, updated, fs))
      try { await childAdapter.verifyAccess() } catch (error) {
        const safeCodes = new Set(['credential_refresh_persist_failed', 'credential_refresh_invalid'])
        throw safeCodes.has(error?.code) ? error : safeError('mesh_access_unverified')
      }
      const currentContext = await scopeContext(scope)
      if (!currentContext) throw safeError('scope_changed')
      return run(childAdapter, currentContext)
    })
  }

  async function serialize(key, fn) {
    const prior = locks.get(key) ?? Promise.resolve()
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const tail = prior.catch(() => {}).then(() => gate)
    locks.set(key, tail)
    await prior.catch(() => {})
    try { return await fn() } finally {
      release()
      if (locks.get(key) === tail) locks.delete(key)
    }
  }

  return Object.freeze({ validateScope, withChildAdapter })
}

function persistTokens(file, record, updated, fs) {
  if (!updated || typeof updated.token !== 'string' || !updated.token
    || (updated.refreshToken !== undefined && updated.refreshToken !== null && typeof updated.refreshToken !== 'string')) throw safeError('credential_refresh_invalid')
  const credentials = { ...record.credentials, token: updated.token }
  if (updated.refreshToken !== undefined) credentials.refreshToken = updated.refreshToken
  const next = { ...record, credentials }
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    fs.chmodSync(temp, 0o600)
    fs.renameSync(temp, file)
    record.credentials = next.credentials
  } catch {
    try { fs.unlinkSync(temp) } catch { /* cleanup best effort */ }
    throw safeError('credential_refresh_persist_failed')
  }
}

function validScope(scope) {
  return scope?.source === 'mesh' && [scope.familyId, scope.childId, scope.sourceAccountId, scope.sourcePersonId]
    .every(validId)
}
function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }
function safeLabel(value) {
  if (typeof value !== 'string') return ''
  // Intentionally strips control bytes from a verified child display name.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80)
}
function parentAccountId(actor) { return createHash('sha256').update(`mesh-parent:${actor}`).digest('hex') }
function sourceIdentityId(person) { return createHash('sha256').update(`mesh-child:${person}`).digest('hex') }
function safeError(code) { const error = new Error(code); error.code = code; return error }
const defaultFs = { readFileSync, writeFileSync, renameSync, chmodSync, unlinkSync }
