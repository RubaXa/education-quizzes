/** @see ../../../docs/decisions/mesh-auth-recovery-2026-11-01.md */
import { createHash } from 'node:crypto'

/** @see ../../../docs/services/telegram-bot/operations.md */
/** Read every registered Mesh source scope without accepting events or touching the notification outbox. */
export async function runMeshSourceCheck({ inventory, meshSource, telemetry = null, diagnoseScheduleDates = false, scheduleDates = null } = {}) {
  if (!inventory?.enumerate || !meshSource?.observe) throw new Error('source_check_unavailable')
  const result = await span(telemetry, 'telegram.source_check.inventory', () => inventory.enumerate(), { source: 'mesh' })
  const blocked = new Map()
  const errorCodes = new Set(['unavailable', 'deadline-exceeded', 'resource-exhausted', 'permission-denied', 'failed-precondition',
    'aborted', 'cancelled', 'not-found', 'unauthenticated', 'internal', 'scope_unavailable', 'credentials_unavailable',
    'credentials_mismatch', 'mesh_auth_required', 'mesh_unavailable', 'mesh_incomplete', 'mesh_access_unverified', 'child_profile_unavailable',
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
  let excludedCalendarEvents = 0
  const partialScopes = []
  const scheduleDateDiagnostics = []
  const coveredChildren = new Set()
  const scopes = (result.scopes ?? []).filter(({ scope }) => scope?.source === 'mesh')
  const selectedDates = Array.isArray(scheduleDates) && scheduleDates.length ? new Set(scheduleDates) : null
  let observedScopes = 0
  for (const { scope } of scopes) {
    if (selectedDates && (scope.kind !== 'schedule' || !selectedDates.has(scope.date))) continue
    coveredChildren.add(`${scope.familyId}/${scope.childId}`)
    observedScopes += 1
    const observation = await span(telemetry, 'telegram.source_check.mesh_observe', () => meshSource.observe(scope), { source: 'mesh' })
    if (diagnoseScheduleDates && scope.kind === 'schedule' && Array.isArray(observation?.scheduleDateDiagnostics)) {
      for (const item of observation.scheduleDateDiagnostics) {
        scheduleDateDiagnostics.push({ scopeDigest: scopeDigest(scope), requestedDate: safeDate(scope.date),
          startDate: safeDate(item?.startDate), startsAt: safeInstant(item?.startsAt), finishesAt: safeInstant(item?.finishesAt),
          eventClass: safeEventClass(item?.eventClass), source: safeEventSource(item?.source),
          hasSubject: item?.hasSubject === true, hasLessonType: item?.hasLessonType === true,
          hasHomework: item?.hasHomework === true, eventDigest: safeDigest(item?.eventDigest) })
      }
    }
    if (observation?.completeness === 'complete' && observation.familyId === scope.familyId
      && observation.childId === scope.childId && Array.isArray(observation.records)) {
      completeObservations += 1
      observedRecords += observation.records.length
      if (scope.kind === 'schedule' && Number.isSafeInteger(observation.excludedCalendarEvents) && observation.excludedCalendarEvents >= 0)
        excludedCalendarEvents += observation.excludedCalendarEvents
    } else {
      partialObservations += 1
      note(observation?.errorCode ?? 'mesh_incomplete')
      partialScopes.push({ scopeDigest: scopeDigest(scope), kind: safeKind(scope?.kind),
        reasonCode: safeReason(observation?.diagnosticCode ?? observation?.errorCode) })
    }
  }
  const meshScopes = scopes.length
  const registeredChildren = result.registeredChildren ?? []
  const expectedChildren = registeredChildren.filter((child) => child.meshStatus
    ? child.meshStatus !== 'not-linked' : child.hasMeshIdentity || child.hasMeshAccount)
  const uncovered = selectedDates ? [] : expectedChildren.filter((child) => !coveredChildren.has(`${child.familyId}/${child.childId}`))
  const uncoveredChildren = uncovered.length
  for (const child of uncovered) {
    const code = child.meshStatus === 'identity-unregistered' ? 'mesh_identity_unregistered'
      : child.meshStatus === 'owner-unavailable' ? 'mesh_owner_unavailable' : 'mesh_scope_unavailable'
    note(code)
  }
  if (meshScopes === 0 && expectedChildren.length === 0) note('mesh_scope_unavailable')
  const coverageComplete = !selectedDates && result.complete === true && partialObservations === 0 && meshScopes > 0 && uncoveredChildren === 0
  return Object.freeze({ schemaVersion: 1, status: coverageComplete ? 'complete' : 'incomplete',
    coverageComplete, writes: 0, sends: 0,
    families: (result.families ?? []).length,
    registeredChildren: (result.registeredChildren ?? []).length,
    meshAccounts: (result.sourceAccounts ?? []).length,
    meshScopes, completeObservations, partialObservations, observedRecords, excludedCalendarEvents,
    ...(selectedDates ? { diagnosticOnly: true, diagnosticScopeCount: observedScopes,
      inventoryScopes: meshScopes, selectedScopes: observedScopes,
      allFamilies: (result.families ?? []).length,
      unobservedScopes: Math.max(0, meshScopes - observedScopes), requestedScheduleDates: [...selectedDates].sort() } : {}),
    uncoveredChildren, partialScopes: partialScopes.sort((a, b) => a.scopeDigest.localeCompare(b.scopeDigest)),
    ...(diagnoseScheduleDates ? { scheduleDateDiagnostics: scheduleDateDiagnostics.sort((a, b) =>
      a.scopeDigest.localeCompare(b.scopeDigest) || (a.startsAt ?? '').localeCompare(b.startsAt ?? '')) } : {}),
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
  const allowed = new Set(['scope_unavailable', 'credentials_unavailable', 'credentials_mismatch', 'mesh_auth_required', 'mesh_unavailable', 'mesh_incomplete',
    'mesh_access_unverified', 'child_profile_unavailable', 'scope_changed', 'credential_refresh_invalid',
    'credential_refresh_persist_failed', 'invalid_observation_shape', 'required_collection_missing', 'invalid_grade_period',
    'invalid_grade_record', 'invalid_mark_record', 'invalid_schedule_record', 'schedule_id_missing', 'schedule_start_invalid',
    'schedule_finish_invalid', 'schedule_date_mismatch', 'invalid_homework_item', 'invalid_homework_lesson',
    'invalid_homework_entry', 'invalid_teacher_file', 'invalid_homework_date'])
  return allowed.has(value) ? value : 'mesh_incomplete'
}
function safeDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null }
function safeInstant(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && validIsoDate(value.slice(0, 10)) && !Number.isNaN(Date.parse(value)) ? value : null }
function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}
function safeEventClass(value) { return value === 'lesson' || value === 'calendar' ? value : 'unknown' }
function safeEventSource(value) { return ['PLAN', 'FACT', 'OLYMPIAD'].includes(value) ? value : 'other' }
function safeDigest(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null }
