import { createHash } from 'node:crypto'

/** @see ../../../docs/services/telegram-bot/operations.md */
export function createTechnicalProbeSource({ kind, db, recipientResolver, meshSource = null,
  clock = () => new Date(), onMeshObservation = () => {} }) {
  if (!['firestore', 'mesh'].includes(kind) || !db || !recipientResolver?.resolve
    || kind === 'mesh' && (!meshSource?.validateScope || !meshSource?.observe)) throw new Error('probe_source_unavailable')
  const scopeKey = (scope) => validScope(scope, kind)
    ? sha(JSON.stringify([`technical-probe-v1:${kind}`, scope.dayToken, scope.familyId, scope.childId, scope.recordId])) : null

  async function request(scope) {
    if (!scopeKey(scope)) return null
    const snap = await db.doc(`telegramOperationalProbes/${scope.dayToken}`).get()
    if (!snap.exists) return null
    const row = snap.data()
    if (row?.status !== 'requested' || row.source !== kind || row.runId !== scope.dayToken
      || row.familyId !== scope.familyId || row.childId !== scope.childId
      || row.targetDigest !== scope.recordId || !validExpiry(row.expiresAt, clock())) return null
    const recipient = await recipientResolver.resolve({ digest: row.targetDigest, familyId: row.familyId, childId: row.childId })
    if (!recipient) return null
    if (kind === 'mesh') {
      const target = scope.meshScope
      if (!target || target.familyId !== row.familyId || target.childId !== row.childId
        || !await meshSource.validateScope(target)) return null
    }
    return row
  }
  async function validateScope(scope) { return Boolean(await request(scope)) }
  async function observe(scope) {
    const key = scopeKey(scope)
    const base = { source: kind, scopeKey: key, familyId: scope?.familyId, childId: scope?.childId }
    if (!key) return { ...base, completeness: 'partial', records: [] }
    try {
      const row = await request(scope)
      if (!row) return { ...base, completeness: 'partial', records: [] }
      if (kind === 'mesh') {
        const observation = await meshSource.observe(scope.meshScope)
        if (observation?.completeness !== 'complete' || observation.familyId !== scope.familyId
          || observation.childId !== scope.childId || !Array.isArray(observation.records)) {
          return { ...base, completeness: 'partial', records: [] }
        }
        try { onMeshObservation({ complete: true, recordCount: observation.records.length }) } catch { /* metrics cannot fail the observation */ }
        if (!await meshSource.validateScope(scope.meshScope)) return { ...base, completeness: 'partial', records: [] }
      }
      const recordKey = sha(JSON.stringify([kind, row.runId, row.targetDigest]))
      return { ...base, completeness: 'complete', observedAt: clock().toISOString(), records: [
        { recordKey, kind: 'probe', eventType: 'technical.probe', fields: {} },
      ] }
    } catch { return { ...base, completeness: 'partial', records: [] } }
  }
  function subscribe({ scopes, onSignal, onError = () => {} } = {}) {
    if (!Array.isArray(scopes) || scopes.some((scope) => !scopeKey(scope)) || typeof onSignal !== 'function') throw new Error('invalid_probe_source_scopes')
    const stops = scopes.map((scope) => db.doc(`telegramOperationalProbes/${scope.dayToken}`).onSnapshot((snap) => {
      if (snap.exists && snap.data()?.status === 'requested') Promise.resolve(onSignal(scope)).catch(() => onError({ code: 'probe_signal_failed' }))
    }, () => onError({ code: 'probe_listener_unavailable' })))
    return async () => { for (const stop of stops) { try { await stop() } catch { /* best effort */ } } }
  }
  return Object.freeze({ kind, scopeKey, validateScope, observe, subscribe })
}

export function createProbeScope({ kind, runId, targetDigest, familyId, childId, meshScope }) {
  const scope = { familyId, childId, kind: 'probe', dayToken: runId, recordId: targetDigest,
    ...(kind === 'mesh' ? { meshScope } : {}) }
  if (!validScope(scope, kind)) throw new Error('invalid_probe_scope')
  return Object.freeze(scope)
}

function validScope(scope, kind) {
  return scope?.kind === 'probe' && ['firestore', 'mesh'].includes(kind)
    && [scope.familyId, scope.childId, scope.dayToken, scope.recordId].every((value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value))
    && /^[a-f0-9]{16}$/.test(scope.recordId)
    && (kind !== 'mesh' || scope.meshScope?.source === 'mesh')
}
function validExpiry(value, now) {
  const expiry = value instanceof Date ? value : typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
  return !Number.isNaN(expiry.valueOf()) && expiry.valueOf() > now.valueOf() && expiry.valueOf() - now.valueOf() <= 10 * 60_000
}
const sha = (value) => createHash('sha256').update(value).digest('hex')
