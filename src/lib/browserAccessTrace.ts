/** @see ../../docs/decisions/olympiad-domain-ldd-2026-10-27.md */
/** Local Log-Driven Development; observations never grant access.
 * @see ../../docs/modules/families/browser-access-trace.md
 * @see ../../docs/decisions/photo-storage-ldd-2026-10-22.md */
const events = ['app.loaded', 'identity.resolved', 'identity.changed', 'access.resolved', 'role.selected', 'route.selected', 'view.rendered', 'access.failed', 'photo.storage', 'help.interaction', 'lesson.interaction', 'olympiad.interaction'] as const
type EventName = typeof events[number]
const roles = ['parent', 'student', 'mixed', 'none', 'unknown', 'pending']
const sources = ['local', 'memory', 'device-server', 'grant-server', 'member-server', 'member-cache', 'profile', 'entry', 'route', 'card', 'storage', 'app']
const reasons = ['cache-hit', 'cache-miss', 'uid-mismatch', 'context-changed', 'stale-revocation-ignored', 'device-binding-changed', 'device-binding-recovered', 'context-saved', 'context-cleared', 'grant-valid', 'grant-invalid', 'device-valid', 'device-invalid', 'member-valid', 'member-invalid', 'role-mismatch', 'profile-loaded', 'role-projection', 'restore-start', 'redemption-start', 'restore-failed', 'waiting', 'ready']
const routes = ['home', 'enter', 'day', 'day-parent', 'days', 'days-parent', 'test', 'preview', 'my', 'review', 'dashboard', 'connect', 'ui-kit', 'olympiad', 'unknown']
const errorCodes = ['permission-denied', 'unavailable', 'deadline-exceeded', 'auth/network-request-failed', 'unauthenticated', 'unknown']
const functions = ['initializeAccessTrace', 'traceProfile', 'restorePersonalContext', 'restorePersonalSession', 'redeemPersonalLink', 'sessionFromGrant', 'loadPersonalProfile', 'recoverPersonalContext', 'rememberPersonalContext', 'clearPersonalSession', 'changedInAnotherTab', 'PersonalEntry#profileEffect', 'PersonalEntry#accessSnapshot', 'LearningRoute#resolve', 'configureRoleDiagnostics', 'reportRoleProjection', 'App#routeEffect', 'savePhotoForTransfer', 'localPhotoForTransfer', 'removePhotoFromOutbox'] as const
const states = ['idle', 'restoring', 'cached', 'checking', 'retrying', 'redeeming', 'loading', 'resolved', 'selected', 'rendered', 'recovered', 'changed', 'cleared', 'failed', 'empty'] as const
const photoStorageOperations = ['savePhotoForTransfer', 'localPhotoForTransfer', 'removePhotoFromOutbox'] as const
const photoStoragePhases = ['checking', 'retrying', 'recovered', 'failed'] as const
const photoStorageErrorCodes = ['indexeddb-connection-lost', 'invalid-state', 'abort', 'quota', 'security', 'data', 'error'] as const
const helpActions = ['opened', 'closed', 'selection-changed', 'photos-added', 'submitted', 'waiting', 'answer-ready', 'answer-opened', 'role-changed', 'failed'] as const
const helpContexts = ['demo', 'product'] as const
const helpErrors = ['upload-failed', 'submit-failed', 'sync-failed', 'unknown'] as const
const olympiadActions = ['list-loaded', 'list-failed', 'list-opened', 'list-closed', 'opened', 'participation-changed', 'participation-failed', 'page-loaded', 'page-failed', 'detail-opened'] as const
const lessonActions = ['opened', 'choice-selected', 'waiting', 'answer-shown', 'next-step', 'completed', 'failed'] as const
const lessonErrors = ['load-failed', 'submit-failed', 'sync-failed', 'unknown'] as const
export type AccessDetail = { role?: string; previousRole?: string; source?: string; reason?: string; route?: string; code?: string; scope?: string; person?: string; device?: string; grant?: string; hasGuide?: boolean; studentUpload?: boolean; active?: boolean; fromCache?: boolean; matches?: boolean; count?: number; durationMs?: number; bundle?: string; atFunction?: string; previousState?: string; state?: string; action?: string; context?: string; hasNote?: boolean }
type TraceEvent = { runId: string; sequence: number; at: number; event: EventName; detail: AccessDetail }
export type AccessTrace = { schemaVersion: 1; events: TraceEvent[] }
export function formatAccessLog(row: TraceEvent): string {
  const detail = safeDetail(row.detail, row.event)
  const explanations: Record<EventName, string> = {
    'app.loaded': 'Load application bundle', 'identity.resolved': detail.source === 'local' ? 'Use saved identity for this device' : 'Resolve identity from the selected source',
    'identity.changed': 'Reconcile a changed credential or device binding', 'access.resolved': detail.source === 'member-server' ? 'Use role from membership document' : 'Compare current access with the selected identity',
    'role.selected': 'Choose the interface from profile membership', 'route.selected': 'Open the resource for the selected identity',
    'view.rendered': 'Observe the committed task card projection', 'access.failed': 'Access operation failed; preserve safe error code',
    'photo.storage': 'Observe local photo storage operation; this does not affect access authority',
    'help.interaction': `Observe photo help interaction: ${detail.action ?? 'unknown'}`,
    'lesson.interaction': `Observe lesson interaction: ${detail.action ?? 'unknown'}`,
    'olympiad.interaction': `Observe olympiad interaction: ${detail.action ?? 'unknown'}`,
  }
  const explanation = detail.state === 'restoring' ? 'Restore saved session for current device' : detail.state === 'redeeming' ? 'Redeem supplied personal credential' : detail.state === 'loading' ? 'Read profile and memberships for selected identity' : explanations[row.event]
  if (row.event === 'help.interaction') return `[tracePhotoHelp] [unknown → ${detail.action ?? 'unknown'}] ${explanation}`
  if (row.event === 'olympiad.interaction') return `[traceOlympiad] [unknown → ${detail.action ?? 'unknown'}] ${explanation}`
  if (row.event === 'lesson.interaction') return `[traceLesson] [unknown → ${detail.action ?? 'unknown'}] ${explanation}`
  return `[${detail.atFunction ?? 'traceProfile'}] [${detail.previousState ?? 'checking'} → ${detail.state ?? 'resolved'}] ${explanation}`
}
const key = 'education-access-trace-v1'
const maxAge = 24 * 60 * 60_000
function safeDetail(input: AccessDetail, event?: EventName): AccessDetail {
  const output: AccessDetail = {}
  if (event === 'olympiad.interaction') {
    if (typeof input.action === 'string' && (olympiadActions as readonly string[]).includes(input.action)) output.action = input.action
    if (typeof input.context === 'string' && (helpContexts as readonly string[]).includes(input.context)) output.context = input.context
    if (input.role === 'student' || input.role === 'parent') output.role = input.role
    if (typeof input.count === 'number' && Number.isSafeInteger(input.count) && input.count >= 0 && input.count < 1e5) output.count = input.count
    return output
  }
  if (event === 'lesson.interaction') {
    if (typeof input.action === 'string' && (lessonActions as readonly string[]).includes(input.action)) output.action = input.action
    if (typeof input.context === 'string' && (helpContexts as readonly string[]).includes(input.context)) output.context = input.context
    if (input.role === 'student' || input.role === 'parent') output.role = input.role
    if (typeof input.count === 'number' && Number.isSafeInteger(input.count) && input.count >= 0 && input.count < 1e5) output.count = input.count
    if (input.action === 'failed' && typeof input.code === 'string' && (lessonErrors as readonly string[]).includes(input.code)) output.code = input.code
    return output
  }
  if (event === 'help.interaction') {
    if (typeof input.action === 'string' && (helpActions as readonly string[]).includes(input.action)) output.action = input.action
    if (typeof input.context === 'string' && (helpContexts as readonly string[]).includes(input.context)) output.context = input.context
    if (input.role === 'student' || input.role === 'parent') output.role = input.role
    if (typeof input.count === 'number' && Number.isSafeInteger(input.count) && input.count >= 0 && input.count < 1e5) output.count = input.count
    if (typeof input.hasNote === 'boolean') output.hasNote = input.hasNote
    if (input.action === 'failed' && typeof input.code === 'string' && (helpErrors as readonly string[]).includes(input.code)) output.code = input.code
    return output
  }
  if (event === 'photo.storage') {
    if (typeof input.atFunction === 'string' && (photoStorageOperations as readonly string[]).includes(input.atFunction)) output.atFunction = input.atFunction
    if (typeof input.state === 'string' && (photoStoragePhases as readonly string[]).includes(input.state)) output.state = input.state
    if (typeof input.code === 'string' && (photoStorageErrorCodes as readonly string[]).includes(input.code)) output.code = input.code
    for (const field of ['count', 'durationMs'] as const) if (typeof input[field] === 'number' && Number.isFinite(input[field]) && input[field]! >= 0 && input[field]! < 1e8) output[field] = Math.round(input[field]!)
    return output
  }
  for (const [field, choices] of Object.entries({ role: roles, previousRole: roles, source: sources, reason: reasons, route: routes, code: errorCodes, atFunction: functions, state: states, previousState: states })) {
    const value = input[field as keyof AccessDetail]
    if (typeof value === 'string' && (choices as readonly string[]).includes(value)) Object.assign(output, { [field]: value })
  }
  for (const field of ['scope', 'person', 'device', 'grant'] as const) if (typeof input[field] === 'string' && /^[a-f0-9]{24}$/.test(input[field]!)) output[field] = input[field]
  for (const field of ['hasGuide', 'studentUpload', 'active', 'fromCache', 'matches'] as const) if (typeof input[field] === 'boolean') output[field] = input[field]
  for (const field of ['count', 'durationMs'] as const) if (typeof input[field] === 'number' && Number.isFinite(input[field]) && input[field]! >= 0 && input[field]! < 1e8) output[field] = Math.round(input[field]!)
  if (typeof input.bundle === 'string' && /^index-[A-Za-z0-9_-]{1,64}\.js$/.test(input.bundle)) output.bundle = input.bundle
  return output
}
export function sanitizeAccessTrace(input: unknown, now = Date.now()): AccessTrace {
  const value = input as Partial<AccessTrace> | null
  const rows = value?.schemaVersion === 1 && Array.isArray(value.events) ? value.events : []
  return { schemaVersion: 1, events: rows.filter((row) => row && events.includes(row.event) && typeof row.runId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(row.runId)
    && Number.isSafeInteger(row.sequence) && row.sequence > 0 && Number.isFinite(row.at) && row.at > now - maxAge && row.at <= now + 60_000 && row.detail && typeof row.detail === 'object')
    .slice(-200).map((row) => ({ runId: row.runId, sequence: row.sequence, at: row.at, event: row.event, detail: safeDetail(row.detail, row.event) })) }
}
export function createAccessTrace({ storage, now = Date.now, runId = 'unavailable', emit }: { storage?: Pick<Storage, 'getItem' | 'setItem'>; now?: () => number; runId?: string; emit?: (event: TraceEvent) => void } = {}) {
  let initial: unknown
  try { initial = JSON.parse(storage?.getItem(key) ?? 'null') } catch { initial = null }
  let rows = sanitizeAccessTrace(initial, now()).events
  let sequence = Math.max(0, ...rows.filter((row) => row.runId === runId).map((row) => row.sequence))
  let droppedRecords = Number.isSafeInteger((initial as { droppedRecords?: number })?.droppedRecords) ? Math.max(0, (initial as { droppedRecords: number }).droppedRecords) : 0
  const coverageUnknown = (initial as { coverageUnknown?: boolean })?.coverageUnknown === true || Boolean((initial as AccessTrace)?.events?.length && !Number.isSafeInteger((initial as { droppedRecords?: number }).droppedRecords))
  const persist = () => { try { storage?.setItem(key, JSON.stringify({ schemaVersion: 1, events: rows, droppedRecords, coverageUnknown })) } catch { /* Optional trace cannot break access. */ } }
  const publish = (row: TraceEvent) => { try { emit?.(row) } catch { /* Optional local sink. */ } }
  return {
    runId,
    coverage: () => ({ complete: droppedRecords === 0 && !coverageUnknown, droppedRecords, ...(coverageUnknown ? { coverageUnknown: true } : {}) }),
    record(event: EventName, detail: AccessDetail) {
      const item = { runId, sequence: ++sequence, at: now(), event, detail: safeDetail(detail, event) }
      const candidates = [...rows, item]
      rows = sanitizeAccessTrace({ schemaVersion: 1, events: candidates }, now()).events
      droppedRecords += candidates.length - rows.length
      persist()
      publish(item)
      return item.sequence
    },
    enrich(sequence: number, detail: AccessDetail) {
      rows = rows.map((row) => {
        if (row.runId !== runId || row.sequence !== sequence) return row
        const updated = { ...row, detail: safeDetail({ ...row.detail, ...detail }, row.event) }
        return updated
      })
      persist()
    },
    snapshot(): AccessTrace { return sanitizeAccessTrace({ schemaVersion: 1, events: rows }, now()) },
  }
}

/** Findings are observations, not authority or an automatic repair. */
export function inspectAccessTrace(input: unknown) {
  // Imported receipts can be historical. Validation still rejects future/expired entries at collection/export.
  const rows = (input as AccessTrace)?.events
  const newest = Array.isArray(rows) ? Math.max(0, ...rows.map((row) => Number(row?.at) || 0)) : Date.now()
  const trace = sanitizeAccessTrace(input, newest)
  const findings = new Set<string>()
  const states = new Map<string, AccessDetail>()
  const views = new Map<string, AccessDetail>()
  for (const event of trace.events) {
    const scope = `${event.runId}:${event.detail.scope ?? 'unscoped'}`
    if (event.event === 'identity.changed') {
      for (const key of states.keys()) if (key.startsWith(`${event.runId}:`)) { states.delete(key); views.delete(key) }
    }
    if ((event.event === 'identity.resolved' || event.event === 'access.resolved') && event.detail.active !== false && ['parent', 'student'].includes(event.detail.role ?? '')) {
      const previous = states.get(scope)
      const authoritative = event.detail.source === 'member-server' && event.detail.fromCache !== true
      if (authoritative || previous?.source !== 'member-server') states.set(scope, event.detail)
    }
    if (event.event === 'view.rendered' && event.detail.source === 'card') {
      views.set(scope, event.detail)
    }
    if (event.detail.reason === 'uid-mismatch') findings.add('cached-device-mismatch')
    if (event.detail.reason === 'role-mismatch') findings.add('profile-membership-mismatch')
    if (event.event === 'access.failed') findings.add(`access-failed:${event.detail.code ?? 'unknown'}`)
  }
  for (const [scope, view] of views) {
    const context = states.get(scope)
    if (context?.role === 'parent' && view.role === 'student') findings.add('parent-context-student-view')
    if (context?.role === 'student' && context.source === 'member-server' && view.role === 'student') findings.add('student-membership-student-view')
  }
  return { status: trace.events.length ? 'observed' : 'insufficient-evidence', events: trace.events.length, runs: [...new Set(trace.events.map((row) => row.runId))].length, findings: [...findings] }
}

let journal: ReturnType<typeof createAccessTrace> | undefined
let pendingContext = Promise.resolve()
function localJournal() {
  if (!journal) {
    let storage: Storage | undefined
    try { storage = sessionStorage } catch { /* Browser can block storage. */ }
    journal = createAccessTrace({ storage, runId: typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `run-${Date.now()}`,
      emit: (event) => console.debug(`[Education LDD] ${formatAccessLog(event)}`, JSON.stringify(event)) })
  }
  return journal
}
export function traceAccess(event: EventName, detail: AccessDetail) {
  if (typeof window === 'undefined') return
  try { localJournal().record(event, detail) } catch { /* Diagnostics must not change access behavior. */ }
}
/** Record only allowlisted photo-storage diagnostics in the existing local trace. */
export function tracePhotoStorage(operation: typeof photoStorageOperations[number], phase: typeof photoStoragePhases[number], code?: typeof photoStorageErrorCodes[number], attempt?: number, durationMs?: number) {
  if (!(photoStorageOperations as readonly string[]).includes(operation)
    || !(photoStoragePhases as readonly string[]).includes(phase)
    || (code !== undefined && !(photoStorageErrorCodes as readonly string[]).includes(code))) return
  traceAccess('photo.storage', { atFunction: operation, state: phase, code, count: attempt, durationMs })
}
/** Local observations only; the UI Kit must identify its interactions as demo. */
export function tracePhotoHelp(action: typeof helpActions[number], context: typeof helpContexts[number], role: 'student' | 'parent', details: { count?: number; hasNote?: boolean; code?: typeof helpErrors[number] } = {}) {
  if (!(helpActions as readonly string[]).includes(action) || !(helpContexts as readonly string[]).includes(context) || !['student', 'parent'].includes(role)) return
  traceAccess('help.interaction', { action, context, role, count: details.count, hasNote: details.hasNote, code: details.code })
}
/** The counter is an ordinal or total supplied by the caller, never the answer itself. */
export function traceLesson(action: typeof lessonActions[number], context: typeof helpContexts[number], role: 'student' | 'parent', details: { count?: number; code?: typeof lessonErrors[number] } = {}) {
  if (!(lessonActions as readonly string[]).includes(action) || !(helpContexts as readonly string[]).includes(context) || !['student', 'parent'].includes(role)) return
  traceAccess('lesson.interaction', { action, context, role, count: details.count, code: details.code })
}
/** Local diagnostic events never include child, contest, answer or URL. */
export function traceOlympiad(action: typeof olympiadActions[number], context: typeof helpContexts[number], role: 'student' | 'parent', count?: number) {
  if (!(olympiadActions as readonly string[]).includes(action) || !(helpContexts as readonly string[]).includes(context) || !['student', 'parent'].includes(role)) return
  traceAccess('olympiad.interaction', { action, context, role, count })
}
export async function accessFingerprint(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24)
}
export function traceAccessContext(event: EventName, detail: AccessDetail, context: { personId?: string; deviceUid?: string; linkToken?: string; familyId?: string; childId?: string }) {
  // Hash asynchronously without delaying the view or retaining raw identities in storage.
  if (typeof window === 'undefined') return
  const sequence = localJournal().record(event, detail)
  pendingContext = pendingContext.then(() => Promise.all([context.personId ? accessFingerprint(context.personId) : undefined, context.deviceUid ? accessFingerprint(context.deviceUid) : undefined, context.linkToken ? accessFingerprint(context.linkToken) : undefined,
    context.familyId && context.childId ? accessFingerprint(`${context.familyId}/${context.childId}`) : undefined])
    .then(([person, device, grant, scope]) => localJournal().enrich(sequence, { person, device, grant, scope }))).catch(() => {})
}

export function traceProfile(profile: { personId: string; children: Array<{ familyId: string; childId: string; role: string }> }, deviceUid?: string, source = 'profile', atFunction: typeof functions[number] = 'traceProfile') {
  for (const child of profile.children) traceAccessContext('identity.resolved', { atFunction, previousState: source === 'local' ? 'restoring' : 'loading', state: source === 'local' ? 'cached' : 'resolved', source, role: child.role, reason: source === 'local' ? 'cache-hit' : 'profile-loaded' }, { personId: profile.personId, deviceUid, ...child })
}
export function accessTraceError(cause: unknown) {
  const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : 'unknown'
  return errorCodes.includes(code) ? code : 'unknown'
}
export function accessRoute() { const route = location.hash.split('/')[1] || 'home'; return routes.includes(route) ? route : 'unknown' }
export function initializeAccessTrace() {
  traceAccess('app.loaded', { atFunction: 'initializeAccessTrace', previousState: 'idle', state: 'resolved', source: 'app', route: accessRoute(), bundle: [...document.scripts].map((script) => script.src.split('/').pop()).find((file) => /^index-[A-Za-z0-9_-]+\.js$/.test(file ?? '')) })
  const api = Object.freeze({ export: exportAccessDiagnostics })
  Object.defineProperty(window, 'educationDiagnostics', { value: api, configurable: true })
}

export async function exportAccessDiagnostics(): Promise<string> {
  await pendingContext
  return JSON.stringify({ ...localJournal().snapshot(), ...localJournal().coverage(), observation: {
    parentGuide: Boolean(document.querySelector('.day-parent-guide')),
    studentUpload: [...document.querySelectorAll('button')].some((button) => /Добавить фото (?:решения|исправления)/.test(button.textContent ?? '')),
    route: accessRoute(),
  } }, null, 2)
}

/** Start the clipboard write inside the click gesture, including Safari/PWA. */
export async function copyAccessDiagnostics(): Promise<void> {
  const receipt = exportAccessDiagnostics()
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': receipt.then(text => new Blob([text], { type: 'text/plain' })) })])
  } else {
    await navigator.clipboard.writeText(await receipt)
  }
}
