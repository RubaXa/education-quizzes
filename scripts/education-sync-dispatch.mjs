import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createEducationFirestore } from '../packages/education-runtime/firestore.mjs'
import { createFirestoreEducationSyncStore } from '../packages/telegram-notifications/application/education-sync-dispatcher.mjs'
import { createFirestoreSourceInventory } from '../packages/telegram-notifications/adapters/source-inventory-firestore.mjs'

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
    } else throw new Error('usage_invalid')
    out.write(`${JSON.stringify(result)}\n`)
    return result.status === 'invalid_claim' || result.status === 'stale_request' ? 1 : 0
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

async function enqueueExistingEvent(db, store, eventId) {
  const eventDoc = await db.collection('telegramNotificationEvents').doc(eventId).get()
  if (!eventDoc.exists) throw new Error('event_not_eligible')
  const event = eventDoc.data() ?? {}
  const eligibleTypes = new Set(['schedule.created', 'schedule.changed', 'schedule.cancelled',
    'homework.assigned', 'homework.changed', 'homework.cancelled', 'grade.created', 'grade.changed'])
  if (event.eventId !== eventId || event.source !== 'mesh' || !eligibleTypes.has(event.eventType)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(event.familyId ?? '') || !/^[A-Za-z0-9_-]{1,128}$/.test(event.childId ?? '')) {
    throw new Error('event_not_eligible')
  }
  const graph = await createFirestoreSourceInventory(db, { includeFirestore: false, includeMesh: false }).enumerate()
  if (!graph.complete || !graph.families.some(({ familyId }) => familyId === event.familyId)
    || !graph.registeredChildren.some((child) => child.familyId === event.familyId && child.childId === event.childId && child.hasMeshAccount)) {
    throw new Error('event_owner_unverified')
  }
  const now = new Date().toISOString()
  const eventDigest = createHash('sha256').update(eventId).digest('hex')
  return store.recordMeshChange({ eventDigest, now, debounceUntil: new Date(Date.parse(now) + 20_000).toISOString() })
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
    ...(state.requestId ? { requestId: state.requestId } : {}), ...(state.retryAt ? { retryAt: state.retryAt } : {}),
    ...(state.lastErrorCode ? { lastErrorCode: state.lastErrorCode } : {}) }
}

function parse(tokens) {
  const result = {}
  for (let index = 0; index < tokens.length; index += 1) {
    const name = tokens[index]
    if (!['--request', '--claim-file', '--event-id'].includes(name) || result[name.slice(2)] !== undefined
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
  const known = new Set(['firestore_project_unavailable', 'usage_invalid', 'claim_file_invalid', 'claim_file_unavailable', 'event_not_eligible', 'event_owner_unverified'])
  return known.has(error?.message) ? error.message : 'education_sync_dispatch_failed'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
