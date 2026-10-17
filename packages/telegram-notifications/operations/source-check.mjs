import { createHash } from 'node:crypto'

/** @see ../../../docs/services/telegram-bot/operations.md */
/** Read every registered Mesh source scope without accepting events or touching the notification outbox. */
export async function runMeshSourceCheck({ inventory, meshSource, telemetry = null } = {}) {
  if (!inventory?.enumerate || !meshSource?.observe) throw new Error('source_check_unavailable')
  const result = await span(telemetry, 'telegram.source_check.inventory', () => inventory.enumerate(), { source: 'mesh' })
  const blocked = new Map()
  const errorCodes = new Set(['unavailable', 'deadline-exceeded', 'resource-exhausted', 'permission-denied', 'failed-precondition',
    'aborted', 'cancelled', 'not-found', 'unauthenticated', 'internal', 'scope_unavailable', 'credentials_unavailable',
    'credentials_mismatch', 'mesh_unavailable', 'mesh_incomplete', 'mesh_access_unverified', 'child_profile_unavailable',
    'scope_changed', 'credential_refresh_invalid', 'credential_refresh_persist_failed', 'source_grade_inventory_invalid',
    'inventory_read_failed', 'mesh_identity_unregistered', 'mesh_owner_unavailable', 'mesh_scope_unavailable'])
  const note = (code, count = 1) => {
    const safe = errorCodes.has(code) ? code : 'mesh_unavailable'
    blocked.set(safe, (blocked.get(safe) ?? 0) + count)
  }
  for (const failure of result.failures ?? []) note(failure.code)
  let completeObservations = 0
  let partialObservations = 0
  let observedRecords = 0
  const partialScopes = []
  const coveredChildren = new Set()
  for (const { scope } of result.scopes ?? []) {
    if (scope?.source !== 'mesh') continue
    coveredChildren.add(`${scope.familyId}/${scope.childId}`)
    const observation = await span(telemetry, 'telegram.source_check.mesh_observe', () => meshSource.observe(scope), { source: 'mesh' })
    if (observation?.completeness === 'complete' && observation.familyId === scope.familyId
      && observation.childId === scope.childId && Array.isArray(observation.records)) {
      completeObservations += 1
      observedRecords += observation.records.length
    } else {
      partialObservations += 1
      note(observation?.errorCode ?? 'mesh_incomplete')
      partialScopes.push({ scopeDigest: scopeDigest(scope), kind: safeKind(scope?.kind),
        reasonCode: safeReason(observation?.diagnosticCode ?? observation?.errorCode) })
    }
  }
  const meshScopes = (result.scopes ?? []).filter(({ scope }) => scope?.source === 'mesh').length
  const registeredChildren = result.registeredChildren ?? []
  const expectedChildren = registeredChildren.filter((child) => child.meshStatus
    ? child.meshStatus !== 'not-linked' : child.hasMeshIdentity || child.hasMeshAccount)
  const uncovered = expectedChildren.filter((child) => !coveredChildren.has(`${child.familyId}/${child.childId}`))
  const uncoveredChildren = uncovered.length
  for (const child of uncovered) {
    const code = child.meshStatus === 'identity-unregistered' ? 'mesh_identity_unregistered'
      : child.meshStatus === 'owner-unavailable' ? 'mesh_owner_unavailable' : 'mesh_scope_unavailable'
    note(code)
  }
  if (meshScopes === 0 && expectedChildren.length === 0) note('mesh_scope_unavailable')
  const coverageComplete = result.complete === true && partialObservations === 0 && meshScopes > 0 && uncoveredChildren === 0
  return Object.freeze({ schemaVersion: 1, status: coverageComplete ? 'complete' : 'incomplete',
    coverageComplete, writes: 0, sends: 0,
    families: (result.families ?? []).length,
    registeredChildren: (result.registeredChildren ?? []).length,
    meshAccounts: (result.sourceAccounts ?? []).length,
    meshScopes, completeObservations, partialObservations, observedRecords,
    uncoveredChildren, partialScopes: partialScopes.sort((a, b) => a.scopeDigest.localeCompare(b.scopeDigest)),
    blockedReasons: Object.fromEntries([...blocked].sort(([left], [right]) => left.localeCompare(right))) })
}

function span(telemetry, operation, work, attrs) {
  return telemetry?.span ? telemetry.span(operation, work, attrs) : work()
}

function scopeDigest(scope) {
  return createHash('sha256').update(JSON.stringify([scope?.familyId, scope?.childId, scope?.sourceAccountId,
    scope?.sourcePersonId, scope?.kind, scope?.date, scope?.subjectId, scope?.periodKey])).digest('hex').slice(0, 16)
}
function safeKind(value) { return ['grades', 'schedule', 'homework'].includes(value) ? value : 'unknown' }
function safeReason(value) {
  const allowed = new Set(['scope_unavailable', 'credentials_unavailable', 'credentials_mismatch', 'mesh_unavailable', 'mesh_incomplete',
    'mesh_access_unverified', 'child_profile_unavailable', 'scope_changed', 'credential_refresh_invalid',
    'credential_refresh_persist_failed', 'invalid_observation_shape', 'required_collection_missing', 'invalid_grade_period',
    'invalid_grade_record', 'invalid_mark_record', 'invalid_schedule_record', 'schedule_id_missing', 'schedule_start_invalid',
    'schedule_finish_invalid', 'schedule_date_mismatch', 'invalid_homework_item', 'invalid_homework_lesson',
    'invalid_homework_entry', 'invalid_teacher_file', 'invalid_homework_date'])
  return allowed.has(value) ? value : 'mesh_incomplete'
}
