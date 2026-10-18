/** Local Log-Driven Development; observations never grant access.
 * @see ../../docs/modules/families/browser-access-trace.md */
const events = ['app.loaded', 'identity.resolved', 'identity.changed', 'access.resolved', 'role.selected', 'route.selected', 'view.rendered', 'access.failed'] as const
type EventName = typeof events[number]
const roles = ['parent', 'student', 'mixed', 'none', 'unknown', 'pending']
const sources = ['local', 'memory', 'device-server', 'grant-server', 'member-server', 'member-cache', 'profile', 'entry', 'route', 'card', 'storage', 'app']
const reasons = ['cache-hit', 'cache-miss', 'uid-mismatch', 'context-changed', 'stale-revocation-ignored', 'device-binding-changed', 'device-binding-recovered', 'context-saved', 'context-cleared', 'grant-valid', 'grant-invalid', 'device-valid', 'device-invalid', 'member-valid', 'member-invalid', 'role-mismatch', 'profile-loaded', 'role-projection', 'restore-start', 'redemption-start', 'restore-failed', 'waiting', 'ready']
const routes = ['home', 'enter', 'day', 'day-parent', 'days', 'days-parent', 'test', 'preview', 'my', 'review', 'dashboard', 'connect', 'ui-kit', 'unknown']
const errorCodes = ['permission-denied', 'unavailable', 'deadline-exceeded', 'auth/network-request-failed', 'unauthenticated', 'unknown']
export type AccessDetail = { role?: string; previousRole?: string; source?: string; reason?: string; route?: string; code?: string; scope?: string; person?: string; device?: string; hasGuide?: boolean; active?: boolean; fromCache?: boolean; matches?: boolean; count?: number; durationMs?: number; bundle?: string }
type TraceEvent = { runId: string; sequence: number; at: number; event: EventName; detail: AccessDetail }
export type AccessTrace = { schemaVersion: 1; events: TraceEvent[] }
const key = 'education-access-trace-v1'
const maxAge = 24 * 60 * 60_000
function safeDetail(input: AccessDetail): AccessDetail {
  const output: AccessDetail = {}
  for (const [field, choices] of Object.entries({ role: roles, previousRole: roles, source: sources, reason: reasons, route: routes, code: errorCodes })) {
    const value = input[field as keyof AccessDetail]
    if (typeof value === 'string' && choices.includes(value)) Object.assign(output, { [field]: value })
  }
  for (const field of ['scope', 'person', 'device'] as const) if (typeof input[field] === 'string' && /^[a-f0-9]{24}$/.test(input[field]!)) output[field] = input[field]
  for (const field of ['hasGuide', 'active', 'fromCache', 'matches'] as const) if (typeof input[field] === 'boolean') output[field] = input[field]
  for (const field of ['count', 'durationMs'] as const) if (typeof input[field] === 'number' && Number.isFinite(input[field]) && input[field]! >= 0 && input[field]! < 1e8) output[field] = Math.round(input[field]!)
  if (typeof input.bundle === 'string' && /^index-[A-Za-z0-9_-]{1,64}\.js$/.test(input.bundle)) output.bundle = input.bundle
  return output
}
export function sanitizeAccessTrace(input: unknown, now = Date.now()): AccessTrace {
  const value = input as Partial<AccessTrace> | null
  const rows = value?.schemaVersion === 1 && Array.isArray(value.events) ? value.events : []
  return { schemaVersion: 1, events: rows.filter((row) => row && events.includes(row.event) && typeof row.runId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(row.runId)
    && Number.isSafeInteger(row.sequence) && row.sequence > 0 && Number.isFinite(row.at) && row.at > now - maxAge && row.at <= now + 60_000 && row.detail && typeof row.detail === 'object')
    .slice(-200).map((row) => ({ runId: row.runId, sequence: row.sequence, at: row.at, event: row.event, detail: safeDetail(row.detail) })) }
}
export function createAccessTrace({ storage, now = Date.now, runId = 'unavailable', emit }: { storage?: Pick<Storage, 'getItem' | 'setItem'>; now?: () => number; runId?: string; emit?: (event: TraceEvent) => void } = {}) {
  let initial: unknown
  try { initial = JSON.parse(storage?.getItem(key) ?? 'null') } catch { initial = null }
  let rows = sanitizeAccessTrace(initial, now()).events
  let sequence = Math.max(0, ...rows.filter((row) => row.runId === runId).map((row) => row.sequence))
  const persist = () => { try { storage?.setItem(key, JSON.stringify({ schemaVersion: 1, events: rows })) } catch { /* Optional trace cannot break access. */ } }
  const publish = (row: TraceEvent) => { try { emit?.(row) } catch { /* Optional local sink. */ } }
  return {
    record(event: EventName, detail: AccessDetail) {
      const item = { runId, sequence: ++sequence, at: now(), event, detail: safeDetail(detail) }
      rows = sanitizeAccessTrace({ schemaVersion: 1, events: [...rows, item] }, now()).events
      persist()
      publish(item)
      return item.sequence
    },
    enrich(sequence: number, detail: AccessDetail) {
      rows = rows.map((row) => {
        if (row.runId !== runId || row.sequence !== sequence) return row
        const updated = { ...row, detail: safeDetail({ ...row.detail, ...detail }) }
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
    if ((event.event === 'identity.resolved' || event.event === 'access.resolved') && event.detail.active !== false && ['parent', 'student'].includes(event.detail.role ?? '')) states.set(scope, event.detail)
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
      emit: (event) => console.debug('[Education LDD]', JSON.stringify(event)) })
  }
  return journal
}
export function traceAccess(event: EventName, detail: AccessDetail) {
  if (typeof window === 'undefined') return
  try { localJournal().record(event, detail) } catch { /* Diagnostics must not change access behavior. */ }
}
export async function accessFingerprint(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24)
}
export function traceAccessContext(event: EventName, detail: AccessDetail, context: { personId?: string; deviceUid?: string; familyId?: string; childId?: string }) {
  // Hash asynchronously without delaying the view or retaining raw identities in storage.
  if (typeof window === 'undefined') return
  const sequence = localJournal().record(event, detail)
  pendingContext = pendingContext.then(() => Promise.all([context.personId ? accessFingerprint(context.personId) : undefined, context.deviceUid ? accessFingerprint(context.deviceUid) : undefined,
    context.familyId && context.childId ? accessFingerprint(`${context.familyId}/${context.childId}`) : undefined])
    .then(([person, device, scope]) => localJournal().enrich(sequence, { person, device, scope }))).catch(() => {})
}
export function traceProfile(profile: { personId: string; children: Array<{ familyId: string; childId: string; role: string }> }, deviceUid?: string, source = 'profile') {
  for (const child of profile.children) traceAccessContext('identity.resolved', { source, role: child.role, reason: source === 'local' ? 'cache-hit' : 'profile-loaded' }, { personId: profile.personId, deviceUid, ...child })
}
export function accessTraceError(cause: unknown) {
  const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : 'unknown'
  return errorCodes.includes(code) ? code : 'unknown'
}
export function accessRoute() { const route = location.hash.split('/')[1] || 'home'; return routes.includes(route) ? route : 'unknown' }
export function initializeAccessTrace() {
  traceAccess('app.loaded', { source: 'app', route: accessRoute(), bundle: [...document.scripts].map((script) => script.src.split('/').pop()).find((file) => /^index-[A-Za-z0-9_-]+\.js$/.test(file ?? '')) })
  const api = Object.freeze({ export: async () => { await pendingContext; return JSON.stringify({ ...localJournal().snapshot(), observation: {
    parentGuide: Boolean(document.querySelector('.day-parent-guide')),
    studentUpload: [...document.querySelectorAll('button')].some((button) => /Добавить фото (?:решения|исправления)/.test(button.textContent ?? '')),
    route: accessRoute(),
  } }, null, 2) } })
  Object.defineProperty(window, 'educationDiagnostics', { value: api, configurable: true })
}
