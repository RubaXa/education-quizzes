import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { inspectTelegramReadiness } from '../packages/telegram-notifications/operations/readiness.mjs'
import { resolveMeshProbeScope, resolveProbeTarget } from '../packages/telegram-notifications/operations/probe-target.mjs'
import { runTechnicalProbe } from '../packages/telegram-notifications/operations/probe-runner.mjs'
import { createRuntime } from '../packages/telegram-notifications/adapters/runtime.mjs'
import { createFirestoreAdapters } from '../packages/telegram-notifications/adapters/firestore.mjs'
import { createFirestoreProbeRecipientResolver } from '../packages/telegram-notifications/adapters/probe-recipient-firestore.mjs'
import { createFirestoreSourceCheckpointStore } from '../packages/telegram-notifications/adapters/source-checkpoint-firestore.mjs'
import { createMeshCredentialResolver } from '../packages/telegram-notifications/adapters/mesh-credentials.mjs'
import { createLegacyMeshCredentialCodec } from '../packages/education-runtime/credentials.mjs'
import { createMeshSessionService } from '../packages/education-runtime/mesh-session.mjs'
import { createMeshSourceAdapter } from '../packages/telegram-notifications/adapters/source-mesh.mjs'
import { ProbeNotificationService } from '../packages/telegram-notifications/application/probe-notifications.mjs'
import { renderEvent } from '../packages/telegram-notifications/domain/renderer.mjs'
import { createLaunchAgentOperations } from '../packages/telegram-notifications/operations/launch-agent.mjs'
import { createRotatingJsonlSink, createTelemetryFromEnvironment } from '../packages/education-runtime/telemetry.mjs'
import { createFirestoreSourceInventory } from '../packages/telegram-notifications/adapters/source-inventory-firestore.mjs'
import { runMeshSourceCheck } from '../packages/telegram-notifications/operations/source-check.mjs'
import { runUploadCheck, parseUploadCheckArgs } from '../packages/telegram-notifications/operations/upload-check.mjs'
import { createFirestoreSourceAdapter } from '../packages/telegram-notifications/adapters/source-firestore.mjs'
import { createFirestoreSourceDiscoveryStore } from '../packages/telegram-notifications/adapters/source-discovery-firestore.mjs'
import { runReviewCheck, parseReviewCheckArgs } from '../packages/telegram-notifications/operations/review-check.mjs'

/** @see ../docs/services/telegram-bot/operations.md */
export async function main(args = process.argv.slice(2), dependencies = {}) {
  const [command, ...rest] = args
  const write = dependencies.write ?? process.stdout.write.bind(process.stdout)
  if (command === 'readiness' && !rest.length) return readiness(dependencies, write)
  if (command === 'probe') return probe(rest, dependencies, write)
  if (command === 'source-check') {
    const options = parseSourceCheckArgs(rest)
    if (options) return sourceCheck(dependencies, write, options)
  }
  if (command === 'upload-check') {
    const options = parseUploadCheckArgs(rest)
    if (options) return uploadCheck(dependencies, write, options)
  }
  if (command === 'review-check') {
    const options = parseReviewCheckArgs(rest)
    if (options) return reviewCheck(dependencies, write, options)
  }
  const operations = dependencies.launchAgent ?? createLaunchAgentOperations({ root: dependencies.root ?? process.cwd(),
    env: dependencies.env ?? process.env, home: dependencies.home, uid: dependencies.uid,
    fs: dependencies.launchFs, exec: dependencies.exec, nodePath: dependencies.nodePath, platform: dependencies.platform })
  if (command === 'install') return launchCommand(rest, () => operations.install({ apply: hasApply(rest) }), write)
  if (command === 'status' && !rest.length) return launchCommand(rest, () => operations.status(), write)
  if (command === 'stop' && !rest.length) return launchCommand(rest, () => operations.stop(), write)
  if (command === 'uninstall') return launchCommand(rest, () => operations.uninstall({ apply: hasApply(rest) }), write)
  emit({ code: 'usage', usage: 'node scripts/telegram-runtime.mjs readiness | source-check [--diagnose-schedule-dates [--date YYYY-MM-DD ...]] | upload-check [--since ISO] | review-check [--since ISO] | probe --source firestore|mesh --target-digest HASH [--apply] | install [--apply] | status | stop | uninstall [--apply]' }, write)
  return 2
}

async function uploadCheck(dependencies, write, options) {
  let db = null
  try {
    const root = dependencies.root ?? process.cwd()
    const env = dependencies.env ?? process.env
    const projectId = env.TELEGRAM_FIRESTORE_PROJECT_ID ?? readFirebaseProject(root)
    if (!projectId) throw safeError('firebase_project_unavailable')
    const factory = dependencies.dbFactory ?? (await import('./lib/admin-firebase.mjs')).operatorFirestore
    db = dependencies.db ?? factory({ cwd: root, projectId })
    const source = dependencies.source ?? createFirestoreSourceAdapter(db)
    const inventory = dependencies.inventory ?? createFirestoreSourceInventory(db, { includeFirestore: true, includeMesh: false })
    const discoveryStore = dependencies.discoveryStore ?? createFirestoreSourceDiscoveryStore(db, {
      namespace: 'notify', scopeKey: (_kind, scope) => source.scopeKey(scope),
    })
    const result = await runUploadCheck({ inventory, discoveryStore, source, since: options.since,
      clock: dependencies.clock,
      readCheckpoint: dependencies.readCheckpoint ?? (async (scopeKey) => {
        const hash = createHash('sha256').update(scopeKey).digest('hex')
        const snapshot = await db.doc(`telegramNotificationSourceCheckpoints/notify_${hash}`).get()
        return snapshot.exists ? snapshot.data() : null
      }),
      readLedgerEventsByRecord: dependencies.readLedgerEventsByRecord ?? (async (recordKey, scopeKey, scope) => {
        const sourceEventKey = createHash('sha256').update(recordKey).digest('hex')
        const scopeHash = createHash('sha256').update(scopeKey).digest('hex')
        const result = await db.collection('telegramNotificationEvents').where('sourceEventKey', '==', sourceEventKey)
          .select('eventId', 'eventType', 'source', 'sourceEventKey', 'scopeKey', 'familyId', 'childId').get()
        return result.docs.map((doc) => doc.data() ?? {}).filter((event) => event.eventType === 'upload.confirmed'
          && event.source === 'firestore' && event.sourceEventKey === sourceEventKey && event.scopeKey === scopeHash
          && event.familyId === scope.familyId && event.childId === scope.childId
          && typeof event.eventId === 'string' && /^[a-f0-9]{64}$/.test(event.eventId))
          .map((event) => ({ eventId: event.eventId }))
      }),
      readOutboxJobs: dependencies.readOutboxJobs ?? (async (eventId) => {
        const result = await db.collection('telegramNotificationOutbox').where('eventId', '==', eventId)
          .select('state', 'partReceipts', 'groupedInto', 'isDigest').get()
        const rows = result.docs.filter((doc) => doc.data()?.isDigest !== true)
        return Promise.all(rows.map(async (doc) => {
          let row = doc.data() ?? {}
          if (row.state === 'grouped' && /^digest_[a-f0-9]{64}$/.test(row.groupedInto ?? '')) {
            const [snapshot] = await db.getAll(db.doc(`telegramNotificationOutbox/${row.groupedInto}`),
              { fieldMask: ['state', 'partReceipts', 'eventJobIds', 'isDigest'] })
            const digest = snapshot.exists ? snapshot.data() : null
            if (digest?.isDigest === true && Array.isArray(digest.eventJobIds) && digest.eventJobIds.includes(doc.id)) row = digest
          }
          return { state: row.state, receiptCount: Array.isArray(row.partReceipts) ? row.partReceipts.length : 0 }
        }))
      }),
    })
    emit(result, write)
    return result.diagnosticComplete ? 0 : 1
  } catch (error) {
    const allowed = new Set(['firebase_project_unavailable', 'upload_check_unavailable'])
    emit({ schemaVersion: 1, diagnosticOnly: true, coverageComplete: false, diagnosticComplete: false,
      blockedReasons: { [allowed.has(error?.safeCode) ? error.safeCode : 'upload_check_failed']: 1 }, writes: 0, sends: 0 }, write)
    return 1
  } finally {
    if (db && dependencies.keepOpen !== true) { try { await db.terminate?.() } catch { /* diagnostic result is already captured */ } }
  }
}

async function reviewCheck(dependencies, write, options) {
  let db = null
  try {
    const root = dependencies.root ?? process.cwd()
    const env = dependencies.env ?? process.env
    const projectId = env.TELEGRAM_FIRESTORE_PROJECT_ID ?? readFirebaseProject(root)
    if (!projectId) throw safeError('firebase_project_unavailable')
    const factory = dependencies.dbFactory ?? (await import('./lib/admin-firebase.mjs')).operatorFirestore
    db = dependencies.db ?? factory({ cwd: root, projectId })
    const source = dependencies.source ?? createFirestoreSourceAdapter(db)
    const inventory = dependencies.inventory ?? createFirestoreSourceInventory(db, { includeFirestore: true, includeMesh: false })
    const discoveryStore = dependencies.discoveryStore ?? createFirestoreSourceDiscoveryStore(db, {
      namespace: 'notify', scopeKey: (_kind, scope) => source.scopeKey(scope),
    })
    const result = await runReviewCheck({ inventory, discoveryStore, source, since: options.since,
      readCheckpoint: dependencies.readCheckpoint ?? (async (scopeKey) => {
        const hash = createHash('sha256').update(scopeKey).digest('hex')
        const snapshot = await db.doc(`telegramNotificationSourceCheckpoints/notify_${hash}`).get()
        return snapshot.exists ? snapshot.data() : null
      }),
      readLedgerEventsByRecord: dependencies.readLedgerEventsByRecord ?? (async (recordKey, scopeKey, scope) => {
        const sourceEventKey = createHash('sha256').update(recordKey).digest('hex')
        const scopeHash = createHash('sha256').update(scopeKey).digest('hex')
        const snapshot = await db.collection('telegramNotificationEvents').where('sourceEventKey', '==', sourceEventKey)
          .select('eventId', 'eventType', 'source', 'sourceEventKey', 'sourceRevision', 'scopeKey', 'familyId', 'childId', 'detectedAt', 'fields.status', 'fields.subject').get()
        return snapshot.docs.map((doc) => doc.data() ?? {}).filter((event) => event.eventType === 'review.changed'
          && event.source === 'firestore' && event.sourceEventKey === sourceEventKey && event.scopeKey === scopeHash
          && event.familyId === scope.familyId && event.childId === scope.childId
          && typeof event.eventId === 'string' && /^[a-f0-9]{64}$/.test(event.eventId))
          .map((event) => ({ eventId: event.eventId, sourceRevision: event.sourceRevision,
            detectedAt: event.detectedAt?.toDate?.()?.toISOString?.() ?? event.detectedAt ?? null,
            fields: { status: event.fields?.status, subject: event.fields?.subject } }))
      }),
      readOutboxJobs: dependencies.readOutboxJobs ?? (async (eventId) => {
        const snapshot = await db.collection('telegramNotificationOutbox').where('eventId', '==', eventId)
          .select('state', 'partReceipts', 'groupedInto', 'isDigest').get()
        return snapshot.docs.map((doc) => { const row = doc.data() ?? {}; return { jobId: doc.id, state: row.state, isDigest: row.isDigest === true,
          groupedInto: typeof row.groupedInto === 'string' ? row.groupedInto : null,
          receiptCount: Array.isArray(row.partReceipts) ? row.partReceipts.length : 0 } })
      }),
      readGroupOutboxJobs: dependencies.readGroupOutboxJobs ?? (async (groupId) => {
        const snapshot = await db.doc(`telegramNotificationOutbox/${groupId}`).get()
        if (!snapshot.exists) return []
        const row = snapshot.data() ?? {}
        if (row.isDigest !== true) return []
        return [{ jobId: snapshot.id, state: row.state,
          eventJobIds: Array.isArray(row.eventJobIds) ? row.eventJobIds.filter((id) => typeof id === 'string') : [],
          receiptCount: Array.isArray(row.partReceipts) ? row.partReceipts.length : 0 }]
      }),
    })
    emit(result, write)
    return result.diagnosticComplete ? 0 : 1
  } catch (error) {
    const allowed = new Set(['firebase_project_unavailable', 'review_check_unavailable'])
    emit({ schemaVersion: 1, diagnosticOnly: true, coverageComplete: false, diagnosticComplete: false,
      blockedReasons: { [allowed.has(error?.safeCode) ? error.safeCode : 'review_check_failed']: 1 }, writes: 0, sends: 0 }, write)
    return 1
  } finally {
    if (db && dependencies.keepOpen !== true) { try { await db.terminate?.() } catch { /* diagnostic result is already captured */ } }
  }
}

async function sourceCheck(dependencies, write, options = { diagnoseScheduleDates: false, scheduleDates: null }) {
  let db = null
  try {
    const root = dependencies.root ?? process.cwd()
    const env = dependencies.env ?? process.env
    const telemetry = dependencies.telemetry ?? createTelemetryFromEnvironment({ sink: createRotatingJsonlSink(
      resolve(env.TELEGRAM_LOG_DIRECTORY ?? resolve(root, '.local/telegram'), 'telemetry.jsonl')) })
    const projectId = env.TELEGRAM_FIRESTORE_PROJECT_ID ?? readFirebaseProject(root)
    if (!projectId) throw safeError('firebase_project_unavailable')
    const factory = dependencies.dbFactory ?? (await import('./lib/admin-firebase.mjs')).operatorFirestore
    db = dependencies.db ?? factory({ cwd: root, projectId, telemetry })
    const meshDirectory = resolve(root, env.TELEGRAM_MESH_CONNECTION_DIRECTORY ?? '.local/mesh-connections')
    const legacyCodec = dependencies.legacyCodec ?? createLegacyMeshCredentialCodec({
      familyAccessPath: resolve(env.TELEGRAM_FAMILY_ACCESS_PATH ?? resolve(root, '.local/family-access.json')),
      credentialsPath: resolve(env.TELEGRAM_LEGACY_CREDENTIALS_PATH ?? resolve(root, '.local/diary/secret.json')) })
    const resolver = dependencies.meshResolver ?? createMeshCredentialResolver({ db, connectionsDir: meshDirectory, legacyCodec, telemetry })
    const meshSource = dependencies.meshSource ?? createMeshSourceAdapter({ resolver, pollMs: 60_000, jitterMs: 0, includeScheduleDateDiagnostics: options.diagnoseScheduleDates })
    const inventory = dependencies.inventory ?? createFirestoreSourceInventory(db, { includeFirestore: false, includeMesh: true,
      meshSource, telemetry })
    const traced = await telemetry.trace('telegram.operational.source_check', async () => ({
      result: await runMeshSourceCheck({ inventory, meshSource, telemetry, ...options }), traceId: telemetry.current().traceId,
    }), { source: 'mesh' })
    const snapshot = telemetry.snapshot()
    emit({ ...traced.result, telemetry: { traceId: traced.traceId, spanCount: snapshot.spanCount,
      counters: snapshot.counters, spans: snapshot.spans, exporterErrors: snapshot.exporterErrors } }, write)
    return traced.result.coverageComplete ? 0 : 1
  } catch (error) {
    const allowed = new Set(['firebase_project_unavailable', 'source_check_unavailable'])
    emit({ schemaVersion: 1, status: 'unavailable', coverageComplete: false,
      blockedReasons: { [allowed.has(error?.safeCode) ? error.safeCode : 'source_check_failed']: 1 }, writes: 0, sends: 0 }, write)
    return 1
  } finally {
    if (db && dependencies.keepOpen !== true) { try { await db.terminate?.() } catch { /* result already captured */ } }
  }
}

function parseSourceCheckArgs(args) {
  let diagnoseScheduleDates = false
  const scheduleDates = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--diagnose-schedule-dates' && !diagnoseScheduleDates) { diagnoseScheduleDates = true; continue }
    if (args[index] === '--date' && isCalendarDate(args[index + 1])) {
      scheduleDates.push(args[index + 1]); index += 1; continue
    }
    return null
  }
  if (scheduleDates.length && !diagnoseScheduleDates) return null
  return { diagnoseScheduleDates, scheduleDates: scheduleDates.length ? [...new Set(scheduleDates)] : null }
}
function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function hasApply(args) { return args.length === 1 && args[0] === '--apply' }
function launchCommand(args, work, write) {
  if (args.some((arg) => arg !== '--apply') || args.filter((arg) => arg === '--apply').length > 1) {
    emit({ code: 'launchagent_usage' }, write)
    return 2
  }
  try { emit({ schemaVersion: 1, ...work() }, write); return 0 }
  catch (error) {
    const safe = new Set(['launchagent_macos_required', 'firebase_project_unavailable', 'bot_token_unavailable',
      'application_credentials_unavailable', 'runtime_dependency_missing', 'release_integrity_failed', 'launchagent_stop_failed',
      'launchagent_bootstrap_failed', 'python_runtime_unavailable', 'npm_runtime_unavailable', 'mesh_credentials_path_unavailable'])
    emit({ schemaVersion: 1, error: safe.has(error?.safeCode) ? error.safeCode : 'launchagent_operation_failed' }, write)
    return 1
  }
}

async function readiness(dependencies, write) {
  let db = null
  try {
    if (dependencies.db !== undefined) db = dependencies.db
    else {
      const factory = dependencies.dbFactory ?? (await import('./lib/admin-firebase.mjs')).operatorFirestore
      db = factory()
    }
    const root = dependencies.root ?? process.cwd()
    const env = dependencies.env ?? process.env
    const launchAgent = dependencies.launchAgent ?? createLaunchAgentOperations({ root, env, home: dependencies.home,
      uid: dependencies.uid, fs: dependencies.launchFs, exec: dependencies.exec, nodePath: dependencies.nodePath,
      platform: dependencies.platform })
    const legacyCodec = dependencies.legacyCodec ?? createLegacyMeshCredentialCodec({
      familyAccessPath: resolve(env.TELEGRAM_FAMILY_ACCESS_PATH ?? resolve(root, '.local/family-access.json')),
      credentialsPath: resolve(env.TELEGRAM_LEGACY_CREDENTIALS_PATH ?? resolve(root, '.local/diary/secret.json')) })
    const connectionsDir = resolve(root, env.TELEGRAM_MESH_CONNECTION_DIRECTORY ?? '.local/mesh-connections')
    const resolveLegacyOwner = dependencies.resolveLegacyOwner ?? (async () => {
      if (!legacyCodec.describeOwner) return false
      const legacy = legacyCodec.describeOwner()
      if (!legacy) return false
      const accounts = await db.collection('sourceAccounts').where('familyId', '==', legacy.familyId).get()
      const ownerAccount = accounts.docs.find((doc) => doc.id === legacy.accountId)
      const personId = ownerAccount?.data()?.personId
      if (typeof personId !== 'string') return false
      const service = createMeshSessionService({ db, connectionsDir, legacyCodec })
      return Boolean(await service.resolveLocalSourceOwner({ familyId: legacy.familyId, personId }))
    })
    let launchAgentStatus = dependencies.launchAgentStatus
    if (!launchAgentStatus) { try { launchAgentStatus = launchAgent.status() } catch { launchAgentStatus = { installed: false, loaded: false, running: false, state: 'unknown' } } }
    const status = await inspectTelegramReadiness({ root, env, fs: dependencies.fs, db,
      launchAgentPath: dependencies.launchAgentPath, launchAgentStatus,
      resolveLegacyOwner, linkIssuerAvailable: dependencies.linkIssuerAvailable ?? true })
    emit(status, write)
    return 0
  } catch {
    emit({ schemaVersion: 1, readyForDelivery: false, blockers: ['readiness_initialization_failed'] },
      write)
    return 1
  } finally {
    if (db && dependencies.keepOpen !== true) {
      try { await db.terminate?.() } catch { /* read-only readiness result is already captured */ }
    }
  }
}

async function probe(args, dependencies, write) {
  let db = null
  try {
    const options = parseProbeArgs(args)
    const root = dependencies.root ?? process.cwd()
    const env = dependencies.env ?? process.env
    const telemetry = dependencies.telemetry ?? createTelemetryFromEnvironment({ sink: createRotatingJsonlSink(
      resolve(env.TELEGRAM_LOG_DIRECTORY ?? resolve(root, '.local/telegram'), 'telemetry.jsonl')) })
    const projectId = env.TELEGRAM_FIRESTORE_PROJECT_ID ?? readFirebaseProject(root)
    if (!projectId) throw safeError('firebase_project_unavailable')
    const factory = dependencies.dbFactory ?? (await import('./lib/admin-firebase.mjs')).operatorFirestore
    db = dependencies.db ?? factory({ cwd: root, projectId, telemetry })
    const target = await (dependencies.resolveProbeTarget ?? resolveProbeTarget)(db, options.targetDigest)
    if (!target) throw safeError('probe_recipient_unavailable')
    const meshDirectory = resolve(root, env.TELEGRAM_MESH_CONNECTION_DIRECTORY ?? '.local/mesh-connections')
    const meshSource = options.source === 'mesh'
      ? (dependencies.meshSource ?? createMeshSource({ db, root, meshDirectory, telemetry })) : null
    const meshScope = options.source === 'mesh'
      ? await (dependencies.resolveMeshProbeScope ?? resolveMeshProbeScope)(db, target, moscowDate()) : null
    if (options.source === 'mesh' && !meshScope) throw safeError('mesh_scope_unavailable')
    const token = env.AGI_EDU_BOT
    if (typeof token !== 'string' || !token.trim()) throw safeError('bot_token_unavailable')
    const config = { token, projectId, instanceId: `telegram-probe-${process.pid}`, meshConnectionDirectory: meshDirectory }
    const runtime = dependencies.runtime ?? createRuntime(config, { firestore: db, telemetry })
    await runtime.verifyFirestore()
    const adapters = dependencies.adapters ?? runtime.adapters ?? createFirestoreAdapters(db)
    const recipientResolver = dependencies.recipientResolver ?? createFirestoreProbeRecipientResolver(db)
    const probeNotifications = dependencies.probeNotifications ?? new ProbeNotificationService({ eventLedger: adapters.eventLedger,
      recipientResolver, renderer: renderEvent })
    const runId = options.runId ?? randomUUID()
    const traced = await telemetry.trace('telegram.operational.probe', async () => ({ result: await runTechnicalProbe({ kind: options.source,
      db, familyId: target.familyId, childId: target.childId, targetDigest: options.targetDigest, runId, meshScope, meshSource,
      checkpoints: dependencies.checkpoints ?? createFirestoreSourceCheckpointStore(db), probeNotifications,
      recipientResolver, telemetry, apply: options.apply, clock: dependencies.clock,
      deliver: dependencies.deliver ?? ((jobId) => runtime.notificationService.runOne({ jobId, skipRecovery: true })),
      readDeliveryReceipt: dependencies.readDeliveryReceipt ?? (async (jobId) => {
        const snap = await db.doc(`telegramNotificationOutbox/${jobId}`).get()
        if (!snap.exists) return null
        const row = snap.data()
        return { state: row.state, partReceipts: row.partReceipts }
      }), workerId: `telegram-probe-${process.pid}` }), traceId: telemetry.current().traceId }), { source: options.source })
    const snapshot = telemetry.snapshot()
    emit({ schemaVersion: 1, ...traced.result, telemetry: { traceId: traced.traceId,
      spanCount: snapshot.spanCount, counters: snapshot.counters, spans: snapshot.spans,
      exporterErrors: snapshot.exporterErrors } }, write)
    return 0
  } catch (error) {
    emit({ schemaVersion: 1, error: safeProbeCode(error) }, write)
    return 1
  } finally {
    if (db && dependencies.keepOpen !== true) {
      try { await db.terminate?.() } catch { /* safe result already captured */ }
    }
  }
}

export function parseProbeArgs(args) {
  let source = null, targetDigest = null, runId = null, apply = false
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--apply') { if (apply) throw safeError('probe_flag_duplicate'); apply = true; continue }
    if (!['--source', '--target-digest', '--run-id'].includes(flag) || !args[index + 1]) throw safeError('probe_usage')
    const value = args[index + 1]
    if (flag === '--source') { if (source) throw safeError('probe_flag_duplicate'); source = value }
    else if (flag === '--target-digest') { if (targetDigest) throw safeError('probe_flag_duplicate'); targetDigest = value }
    else { if (runId) throw safeError('probe_flag_duplicate'); runId = value }
    index += 1
  }
  if (!['firestore', 'mesh'].includes(source) || !/^[a-f0-9]{16}$/.test(targetDigest ?? '')
    || (runId && !/^[A-Za-z0-9_-]{1,128}$/.test(runId))) throw safeError('probe_usage')
  return Object.freeze({ source, targetDigest, runId, apply })
}

function createMeshSource({ db, root, meshDirectory, telemetry }) {
  const legacyCodec = createLegacyMeshCredentialCodec({ familyAccessPath: resolve(root, '.local/family-access.json'),
    credentialsPath: resolve(root, '.local/diary/secret.json') })
  const resolver = createMeshCredentialResolver({ db, connectionsDir: meshDirectory, legacyCodec, telemetry })
  return createMeshSourceAdapter({ resolver, pollMs: 60_000, jitterMs: 0 })
}

function readFirebaseProject(root) {
  try {
    const project = JSON.parse(readFileSync(resolve(root, '.firebaserc'), 'utf8'))?.projects?.default
    return typeof project === 'string' && /^[a-z][a-z0-9-]{4,62}$/.test(project) ? project : null
  } catch { return null }
}
function moscowDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
function safeError(code) { const error = new Error(code); error.safeCode = code; return error }
function safeProbeCode(error) {
  const allowed = new Set(['probe_usage', 'probe_flag_duplicate', 'firebase_project_unavailable', 'probe_recipient_unavailable',
    'mesh_scope_unavailable', 'bot_token_unavailable', 'invalid_probe_request', 'probe_run_exists', 'probe_timeout',
    'probe_pipeline_incomplete', 'probe_delivery_not_attempted', 'probe_delivery_receipt_unavailable'])
  return allowed.has(error?.safeCode) ? error.safeCode : allowed.has(error?.message) ? error.message : 'probe_failed'
}
function emit(value, write) { write(`${JSON.stringify(value)}\n`) }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
