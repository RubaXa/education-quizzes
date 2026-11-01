/** @see ../../docs/decisions/mesh-auth-recovery-2026-11-01.md */
/** Shared owner validation and per-child Mesh session lifecycle.
 * @see ../../docs/shared/server-runtime.md#авторизация-и-совместимость
 */
import { MeshDiaryAdapter, meshAuthFailure } from '../education-connect/lib/mesh.mjs'
import { createMeshCredentialStore } from './credentials.mjs'
import { isOwnedMeshAccount, isRegisteredMeshChild, meshChildIdentityId, meshParentAccountId, validRuntimeId } from './identity.mjs'

/** Shared source-account authorization and fresh per-child Mesh adapter lifecycle. */
export function createMeshSessionService({ db, connectionsDir, legacyCodec = null, fs, telemetry = null,
  shutdownSignal = null, adapterFactory = (credentials, save, observer, signal) => new MeshDiaryAdapter(credentials, save, { telemetry: observer, signal }) } = {}) {
  if (!db || !connectionsDir) throw new Error('invalid_mesh_session_config')
  const credentials = createMeshCredentialStore({ connectionsDir, legacyCodec, fs, telemetry })

  async function ownerContext(scope, signal = null) {
    if (!validScope(scope)) return null
    if (signal?.aborted || shutdownSignal?.aborted) return null
    try {
      const identityId = meshChildIdentityId(scope.sourcePersonId)
      const [familySnap, childSnap, accountSnap, identitySnap] = await Promise.all([
        read(`families/${scope.familyId}`, 'family'),
        read(`families/${scope.familyId}/children/${scope.childId}`, 'child'),
        read(`sourceAccounts/${scope.sourceAccountId}`, 'account'),
        read(`sourceIdentities/${identityId}`, 'identity'),
      ])
      if (![familySnap, childSnap, accountSnap, identitySnap].every((snapshot) => snapshot.exists)) return null
      const family = familySnap.data(), child = childSnap.data(), account = { ...accountSnap.data(), id: scope.sourceAccountId },
        identity = { ...identitySnap.data(), id: identityId }
      // Membership is fetched only after the exact registry/account binding matches.
      if (!isRegisteredMeshChild({ ...scope, family, child, identity }) || account.source !== 'mesh'
        || account.familyId !== scope.familyId || account.disconnectedAt || !validRuntimeId(account.personId)
        || !validRuntimeId(account.sourcePersonId) || meshParentAccountId(account.sourcePersonId) !== scope.sourceAccountId) return null
      const memberSnap = await read(`families/${scope.familyId}/members/${account.personId}`, 'member')
      const member = memberSnap.exists ? { ...memberSnap.data(), id: account.personId } : null
      if (!isOwnedMeshAccount({ ...scope, family, child, identity, account, member })) return null
      return { childName: safeLabel(child.displayName), actorPersonId: account.sourcePersonId,
        parentPersonId: account.personId, familyId: scope.familyId, childId: scope.childId,
        sourceAccountId: scope.sourceAccountId }
    } catch { return null }
  }

  async function validateScope(scope, { signal = null } = {}) { return Boolean(await ownerContext(scope, combineSignals(signal, shutdownSignal))) }

  /** Resolve a pairing candidate only through an active registered local Mesh account. */
  async function resolveLocalSourceOwner({ familyId, personId } = {}) {
    if (!validRuntimeId(familyId) || !validRuntimeId(personId)) return null
    try {
      const [familySnap, memberSnap, accountQuery] = await Promise.all([
        read(`families/${familyId}`, 'family'), read(`families/${familyId}/members/${personId}`, 'member'),
        span('firestore.owner.accounts', () => db.collection('sourceAccounts').where('familyId', '==', familyId).get(), telemetry),
      ])
      if (!familySnap.exists || familySnap.data()?.active === false || !memberSnap.exists) return null
      const member = { ...memberSnap.data(), id: personId }
      if (member.active !== true || member.role !== 'parent') return null
      for (const document of accountQuery.docs ?? []) {
        const account = { ...document.data(), id: document.id }
        if (account.source !== 'mesh' || account.familyId !== familyId || account.personId !== personId
          || account.disconnectedAt || !validRuntimeId(account.sourcePersonId)
          || meshParentAccountId(account.sourcePersonId) !== account.id) continue
        const credentialState = credentials.credentialState(account.id)
        if (credentialState === 'valid') return Object.freeze({ familyId, personId, sourceAccountId: account.id })
        if (credentialState !== 'missing') continue // Never hide a broken canonical file with legacy credentials.
        const legacy = legacyCodec?.describeOwner?.()
        if (legacy?.accountId !== account.id || legacy.familyId !== familyId) continue
        const scope = { source: 'mesh', familyId, childId: legacy.childId, sourceAccountId: account.id,
          sourcePersonId: (await read(`families/${familyId}/children/${legacy.childId}`, 'child')).data()?.meshPersonId }
        const context = await ownerContext(scope)
        if (context) return Object.freeze({ familyId, personId, sourceAccountId: account.id })
      }
      return null
    } catch { return null }
  }

  async function withChildAdapter(scope, run, { legacyOwner = null, signal = null } = {}) {
    if (typeof run !== 'function' || !validScope(scope)) throw safeError('invalid_scope')
    const requestedSignal = combineSignals(signal, shutdownSignal)
    if (requestedSignal?.aborted) throw safeError('worker_shutdown')
    return credentials.withAccountLock(scope.sourceAccountId, async (lease) => {
      const context = await ownerContext(scope, requestedSignal)
      if (!context) throw safeError('scope_unavailable')
      lease.assertHeld()
      const loaded = credentials.load(scope.sourceAccountId, legacyOwner, lease)
      if (loaded.credentials.actorPersonId !== context.actorPersonId
        || meshParentAccountId(loaded.credentials.actorPersonId) !== scope.sourceAccountId) throw safeError('credentials_mismatch')
      const save = (updated) => loaded.save(updated)
      const adapterSignal = combineSignals(requestedSignal, lease.signal)
      const accountAdapter = adapterFactory({ ...loaded.credentials }, save, telemetry, adapterSignal)
      guardMeshAdapter(accountAdapter, lease)
      let profiles
      try {
        profiles = await span('mesh.session.profile_lookup', () => accountAdapter.api.getStudentProfiles(context.actorPersonId), telemetry)
      } catch (error) {
        if (['credential_refresh_persist_failed', 'credential_refresh_invalid', 'account_lock_lost'].includes(error?.code)) throw error
        throw meshAuthFailure(error) ?? safeError('mesh_unavailable')
      }
      if (!Array.isArray(profiles)) throw safeError('mesh_unavailable')
      const selected = profiles.find((profile) => String(profile?.person_id ?? '') === scope.sourcePersonId)
      if (!selected?.id) throw safeError('child_profile_unavailable')
      const childCredentials = { ...loaded.credentials, personId: String(selected.person_id),
        profileId: String(selected.id), studentId: String(selected.id) }
      const childAdapter = adapterFactory(childCredentials, save, telemetry, adapterSignal)
      guardMeshAdapter(childAdapter, lease)
      try { await span('mesh.session.verify_access', () => childAdapter.verifyAccess(), telemetry) }
      catch (error) {
        if (['credential_refresh_persist_failed', 'credential_refresh_invalid', 'account_lock_lost'].includes(error?.code)) throw error
        throw meshAuthFailure(error) ?? safeError('mesh_access_unverified')
      }
      const confirmed = await ownerContext(scope, adapterSignal)
      if (!confirmed || confirmed.actorPersonId !== context.actorPersonId) throw safeError('scope_changed')
      const result = await run(childAdapter, Object.freeze({ ...confirmed, signal: adapterSignal, assertHeld: lease.assertHeld }))
      lease.assertHeld()
      return result
    }, { signal: requestedSignal })
  }

  async function read(path, operation) {
    return span(`firestore.owner.${operation}`, () => db.doc(path).get(), telemetry)
  }

  return Object.freeze({ validateScope, withChildAdapter, resolveLocalSourceOwner, credentials })
}

function combineSignals(...signals) {
  const active = signals.filter((signal) => signal && typeof signal.aborted === 'boolean')
  if (!active.length) return null
  if (active.length === 1) return active[0]
  return AbortSignal.any(active)
}

function validScope(scope) {
  return scope?.source === 'mesh' && [scope.familyId, scope.childId, scope.sourceAccountId, scope.sourcePersonId].every(validRuntimeId)
}
function safeLabel(value) {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80)
}
function guardMeshAdapter(adapter, lease) {
  if (!adapter || typeof adapter !== 'object') return
  if (adapter.api && typeof adapter.api === 'object') {
    const api = adapter.api
    adapter.api = new Proxy(api, { get(target, property) {
      const value = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value
      return async (...args) => {
        lease.assertHeld()
        const result = await Reflect.apply(value, target, args)
        lease.assertHeld()
        return result
      }
    } })
  }
  for (const method of ['verifyAccess', 'getProfile', 'getMarks', 'getSchedule', 'getAssignments', 'getLessonDetails', 'getSchoolCalendar']) {
    if (typeof adapter[method] !== 'function') continue
    const original = adapter[method].bind(adapter)
    adapter[method] = async (...args) => {
      lease.assertHeld()
      const result = await original(...args)
      lease.assertHeld()
      return result
    }
  }
}
function safeError(code) { const error = new Error(code); error.code = code; return error }
function span(operation, work, telemetry) {
  return telemetry?.span ? telemetry.span(operation, work, { source: operation.startsWith('firestore.') ? 'firestore' : 'mesh' }) : work()
}
