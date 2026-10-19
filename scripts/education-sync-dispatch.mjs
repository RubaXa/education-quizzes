import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createEducationFirestore } from '../packages/education-runtime/firestore.mjs'
import { createFirestoreEducationSyncStore, workEventDigest } from '../packages/telegram-notifications/application/education-sync-dispatcher.mjs'
import { createFirestoreSourceInventory } from '../packages/telegram-notifications/adapters/source-inventory-firestore.mjs'
import { exportEventTaskManifest } from '../sync/event-task-export.mjs'

/** @see ../docs/services/telegram-bot/education-sync-dispatch.md */
export async function main(args = process.argv.slice(2), { env = process.env, out = process.stdout,
  err = process.stderr, scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  createDb = createEducationFirestore, createStore = createFirestoreEducationSyncStore } = {}) {
  let db
  try {
    // The executing Codex chat may start in a parent directory. Resolve the
    // project from this script unless the service explicitly supplies its root.
    const root = resolve(env.EDUCATION_SYNC_PROJECT_ROOT || scriptRoot)
    const projectId = env.TELEGRAM_FIRESTORE_PROJECT_ID || readFirebaseProject(root)
    if (!projectId || !/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) throw new Error('firestore_project_unavailable')
    const command = args[0]
    const values = parse(args.slice(1))
    db = createDb({ projectId, cwd: root, env })
    const store = createStore(db)
    let result
    if (command === 'status' && Object.keys(values).length === 0) {
      const state = await store.read()
      result = state ? summarize(state) : { status: 'idle', generation: 0 }
    } else if (command === 'claim' && validRequest(values.request) && Object.keys(values).length === 1) {
      result = await claimRequest(store, root, values.request)
    } else if (command === 'enqueue-event' && /^[a-f0-9]{64}$/.test(values['event-id'] ?? '') && Object.keys(values).length === 1) {
      result = await enqueueExistingEvent(db, store, values['event-id'])
    } else if (command === 'events' && Object.keys(values).length === 1 && Number.isFinite(Date.parse(values.since ?? ''))) {
    result = await listEvents(db, values.since)
    } else if (command === 'tasks' && validRequest(values.request) && typeof values['claim-file'] === 'string' && Object.keys(values).length === 2) {
      const claim = readClaimFile(root, values['claim-file'], values.request)
      result = await exportEventTaskManifest(db, store, { root, requestId: values.request,
        tokenHash: createHash('sha256').update(claim.token).digest('hex') })
    } else if (['complete', 'fail', 'heartbeat'].includes(command) && validRequest(values.request)
      && typeof values['claim-file'] === 'string' && Object.keys(values).length === 2) {
      const claim = readClaimFile(root, values['claim-file'], values.request)
      const tokenHash = createHash('sha256').update(claim.token).digest('hex')
      result = command === 'complete'
        ? await store.completeClaim({ requestId: values.request, tokenHash, now: new Date().toISOString() })
        : command === 'heartbeat'
          ? await store.heartbeatClaim({ requestId: values.request, tokenHash, now: new Date().toISOString() })
          : await store.failClaim({ requestId: values.request, tokenHash, now: new Date().toISOString(), retryAt: new Date(Date.now() + 60_000).toISOString() })
      if (['completed', 'pending'].includes(result.status)) rmSync(resolve(root, '.local/education-sync-dispatch/claims', `${values.request}.json`), { force: true })
    } else if (command === 'block' && validRequest(values.request) && typeof values['claim-file'] === 'string'
      && ['permission_required', 'source_unavailable', 'manual_review_required'].includes(values.reason)
      && Object.keys(values).length === 3) {
      const claim = readClaimFile(root, values['claim-file'], values.request)
      const tokenHash = createHash('sha256').update(claim.token).digest('hex')
      result = await store.blockClaim({ requestId: values.request, tokenHash, reasonCode: values.reason, now: new Date().toISOString() })
      if (result.status === 'blocked') rmSync(resolve(root, '.local/education-sync-dispatch/claims', `${values.request}.json`), { force: true })
    } else if (command === 'resume' && validRequest(values.request) && Object.keys(values).length === 1) {
      result = await store.resumeBlocked({ requestId: values.request, now: new Date().toISOString() })
    } else throw new Error('usage_invalid')
    out.write(`${JSON.stringify(result)}\n`)
    return ['invalid_claim', 'stale_request', 'invalid_reason', 'not_blocked', 'incomplete_actions'].includes(result.status) ? 1 : 0
  } catch (error) {
    err.write(`${safeError(error)}\n`)
    return 1
  } finally {
    try { await db?.terminate?.() } catch { /* process exit closes any remaining client handles */ }
  }
}

async function claimRequest(store, projectRoot, requestId) {
  const token = randomUUID()
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const result = await store.claimRequest({ requestId, tokenHash, now: new Date().toISOString() })
  if (result.status !== 'claimed') return result
  const claimPath = resolve(projectRoot, '.local/education-sync-dispatch/claims', `${requestId}.json`)
  const temporary = `${claimPath}.${randomUUID()}.tmp`
  try {
    mkdirSync(dirname(claimPath), { recursive: true, mode: 0o700 })
    writeFileSync(temporary, JSON.stringify({ requestId, token }), { mode: 0o600, flag: 'wx' })
    chmodSync(temporary, 0o600)
    renameSync(temporary, claimPath)
    chmodSync(claimPath, 0o600)
  } catch {
    rmSync(temporary, { force: true })
    await store.failClaim({ requestId, tokenHash, now: new Date().toISOString(), retryAt: new Date().toISOString() })
    throw new Error('claim_file_unavailable')
  }
  return { status: 'claimed', claimPath }
}

export async function enqueueExistingEvent(db, store, eventId, { createInventory = createFirestoreSourceInventory } = {}) {
  const eventDoc = await db.collection('telegramNotificationEvents').doc(eventId).get()
  if (!eventDoc.exists) throw new Error('event_not_eligible')
  const event = eventDoc.data() ?? {}
  const meshTypes = new Set(['schedule.created', 'schedule.changed', 'schedule.cancelled',
    'homework.assigned', 'homework.changed', 'homework.cancelled', 'grade.created', 'grade.changed'])
  const workTypes = new Set(['upload.confirmed', 'quiz.submitted'])
  const kind = event.source === 'mesh' && meshTypes.has(event.eventType) ? 'mesh'
    : event.source === 'firestore' && workTypes.has(event.eventType) ? 'work' : null
  if (event.eventId !== eventId || !kind
    || !/^[A-Za-z0-9_-]{1,128}$/.test(event.familyId ?? '') || !/^[A-Za-z0-9_-]{1,128}$/.test(event.childId ?? '')) {
    throw new Error('event_not_eligible')
  }
  const graph = await createInventory(db, { includeFirestore: false, includeMesh: false }).enumerate()
  if (!graph.complete || !graph.families.some(({ familyId }) => familyId === event.familyId)
    || !graph.registeredChildren.some((child) => child.familyId === event.familyId && child.childId === event.childId
      && (kind === 'work' || child.hasMeshAccount))) {
    throw new Error('event_owner_unverified')
  }
  const now = new Date().toISOString()
  const eventDigest = kind === 'work' ? workEventDigest(event) : createHash('sha256').update(eventId).digest('hex')
  return store.recordSourceChange({ eventDigest, kind, now, debounceUntil: new Date(Date.parse(now) + 20_000).toISOString() })
}

export async function listEvents(db, since, { createInventory = createFirestoreSourceInventory } = {}) {
  const query = db.collection('telegramNotificationEvents').where('detectedAt', '>=', new Date(since).toISOString())
    .orderBy('detectedAt', 'desc').limit(101)
  if (typeof query.select !== 'function') throw new Error('event_listing_unavailable')
  const selected = query.select('eventId', 'source', 'eventType', 'occurredAt', 'detectedAt', 'familyId', 'childId')
  const snapshot = await selected.get()
  const docs = snapshot.docs.map((doc) => doc.data() ?? {})
  const inventory = await createInventory(db, { includeFirestore: false, includeMesh: false }).enumerate()
  if (!inventory.complete) throw new Error('event_owner_unverified')
  const eligibleOwners = new Map(inventory.registeredChildren.map(({ familyId, childId, hasMeshAccount }) => [`${familyId}/${childId}`, hasMeshAccount]))
  const events = docs.filter((event) => Date.parse(event.detectedAt ?? '') >= Date.parse(since)
    && (event.source === 'firestore' && ['upload.confirmed', 'quiz.submitted'].includes(event.eventType)
      || event.source === 'mesh' && ['schedule.created', 'schedule.changed', 'schedule.cancelled', 'homework.assigned', 'homework.changed', 'homework.cancelled', 'grade.created', 'grade.changed'].includes(event.eventType)))
    .filter((event) => /^[a-f0-9]{64}$/.test(event.eventId ?? '') && /^[A-Za-z0-9_-]{1,128}$/.test(event.familyId ?? '')
      && /^[A-Za-z0-9_-]{1,128}$/.test(event.childId ?? '')
      && (event.source === 'firestore' ? eligibleOwners.has(`${event.familyId}/${event.childId}`)
        : eligibleOwners.get(`${event.familyId}/${event.childId}`) === true))
    .map((event) => ({ eventId: event.eventId, source: event.source, eventType: event.eventType, detectedAt: event.detectedAt,
      ...workSourceTiming(event) }))
  return { events: events.slice(0, 100), truncated: docs.length > 100, scanned: docs.length }
}

function workSourceTiming(event) {
  // Mesh occurredAt is a school date, not a transport timestamp. Work events
  // use the confirmed upload/submission time from their normalized source.
  if (event.source !== 'firestore' || typeof event.occurredAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T/.test(event.occurredAt)) return {}
  const occurred = Date.parse(event.occurredAt), detected = Date.parse(event.detectedAt)
  if (!Number.isFinite(occurred) || !Number.isFinite(detected)) return {}
  return { sourceOccurredAt: new Date(occurred).toISOString(),
    ...(detected >= occurred ? { sourceToDetectionMs: detected - occurred } : {}) }
}

function readClaimFile(projectRoot, suppliedPath, requestId) {
  const expected = resolve(projectRoot, '.local/education-sync-dispatch/claims', `${requestId}.json`)
  if (resolve(suppliedPath) !== expected || !existsSync(expected)) throw new Error('claim_file_invalid')
  const info = statSync(expected)
  if (!info.isFile() || (info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('claim_file_invalid')
  let parsed
  try { parsed = JSON.parse(readFileSync(expected, 'utf8')) } catch { throw new Error('claim_file_invalid') }
  if (parsed.requestId !== requestId || typeof parsed.token !== 'string' || !/^[0-9a-f-]{36}$/i.test(parsed.token)) throw new Error('claim_file_invalid')
  return parsed
}

function summarize(state) {
  return { status: state.status, generation: state.generation ?? 0,
    ...(Number.isInteger(state.sendingGeneration) ? { sendingGeneration: state.sendingGeneration } : {}),
    ...(Array.isArray(state.pendingKinds) ? { pendingKinds: safeKinds(state.pendingKinds) } : {}),
    ...(Array.isArray(state.sendingKinds) ? { sendingKinds: safeKinds(state.sendingKinds) } : {}),
    ...(state.requestId ? { requestId: state.requestId } : {}), ...(state.retryAt ? { retryAt: state.retryAt } : {}),
    ...(state.lastErrorCode ? { lastErrorCode: state.lastErrorCode } : {}),
    ...(state.blockedReasonCode ? { blockedReasonCode: state.blockedReasonCode } : {}) }
}

function safeKinds(value) { return [...new Set(value.filter((kind) => kind === 'mesh' || kind === 'work'))] }

function parse(tokens) {
  const result = {}
    for (let index = 0; index < tokens.length; index += 1) {
    const name = tokens[index]
    if (!['--request', '--claim-file', '--event-id', '--reason', '--since'].includes(name) || result[name.slice(2)] !== undefined
      || typeof tokens[index + 1] !== 'string' || tokens[index + 1].startsWith('--')) throw new Error('usage_invalid')
    result[name.slice(2)] = tokens[++index]
  }
  return result
}

function validRequest(value) { return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) }
function readFirebaseProject(root) {
  try { return JSON.parse(readFileSync(resolve(root, '.firebaserc'), 'utf8'))?.projects?.default ?? null }
  catch { return null }
}
function safeError(error) {
  const known = new Set(['firestore_project_unavailable', 'usage_invalid', 'claim_file_invalid', 'claim_file_unavailable', 'event_not_eligible', 'event_owner_unverified',
    'task_manifest_unavailable', 'task_manifest_incomplete', 'task_manifest_invalid', 'task_manifest_cursor_invalid',
    'task_artifact_invalid', 'task_artifact_superseded', 'task_artifact_refresh_conflict', 'task_owner_mismatch',
    'task_owner_unavailable', 'task_source_missing', 'task_source_superseded', 'task_source_not_reviewable', 'task_context_missing'])
  return known.has(error?.message) ? error.message : 'education_sync_dispatch_failed'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
