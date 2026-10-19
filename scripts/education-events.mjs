#!/usr/bin/env node
/** Read-only, bounded queue status for the unified Education event store.
 * @see ../docs/modules/synchronization/event-queue.md
 * @see ../docs/operations/deployment.md
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createEducationFirestore } from '../packages/education-runtime/firestore.mjs'
import { EDUCATION_EVENT_TYPES } from '../packages/education-runtime/event-queue.mjs'

const eventStates = Object.freeze(['pending', 'processing', 'blocked', 'dead_letter'])
const diagnosticStages = new Set(['initialize', 'latest', ...eventStates])
const retryableGrpcCodes = new Set([4, 8, 10, 14])
const eventTypes = new Set(EDUCATION_EVENT_TYPES)
const safeErrorCodes = new Set([
  'account_lock_lost', 'account_lock_required', 'account_lock_timeout', 'account_lock_unavailable',
  'application_credentials_unavailable', 'bot_token_unavailable', 'channel_state_changed', 'channel_state_unavailable',
  'channel_unavailable', 'checkpoint_stale_lease', 'checkpoint_too_large', 'child_profile_unavailable',
  'credential_refresh_invalid', 'credential_refresh_persist_failed', 'credentials_mismatch', 'credentials_unavailable',
  'education_sync_action_handler_unavailable', 'education_sync_config_unavailable', 'education_sync_mesh_handler_unavailable',
  'firebase_project_unavailable', 'firestore_index_api_failed', 'firestore_project_required', 'firestore_project_unavailable',
  'group_event_mismatch', 'group_membership_mismatch', 'group_render_invalid', 'index_manifest_duplicate',
  'index_manifest_invalid', 'index_plan_mismatch', 'invalid_apply_mode', 'invalid_arguments', 'invalid_command',
  'invalid_index_manager_config', 'invalid_material_source', 'invalid_probe_request', 'invalid_scope', 'invalid_upload_source',
  'job_unavailable', 'launchagent_bootstrap_failed', 'launchagent_macos_required', 'launchagent_stop_failed',
  'launchagent_stop_timeout', 'material_bytes_not_visible', 'material_content_mismatch', 'material_not_needs_identification',
  'material_size_mismatch', 'membership_inactive', 'mesh_access_unverified', 'mesh_credentials_path_unavailable',
  'mesh_scope_unavailable', 'mesh_unavailable', 'notification_service_unavailable', 'npm_runtime_unavailable',
  'part_order_invalid', 'probe_delivery_not_attempted', 'probe_delivery_receipt_unavailable', 'probe_flag_duplicate',
  'probe_pipeline_incomplete', 'probe_recipient_unavailable', 'probe_run_exists', 'probe_timeout', 'probe_usage',
  'python_runtime_unavailable', 'release_integrity_failed', 'retry_later', 'retry_limit_reached', 'runtime_dependency_missing',
  'scope_changed', 'scope_unavailable', 'server_action_handler_unavailable', 'shared_material_missing',
  'shutdown_stage_timeout', 'source_reference_invalid', 'stale_lease', 'task_source_missing', 'telegram_temporary',
  'temporary', 'unsupported_event_action', 'unsupported_job_schema', 'upload_bytes_not_visible',
  'upload_content_mismatch', 'upload_link_unavailable', 'upload_owner_changed', 'upload_size_mismatch',
  'upload_storage_credentials_unavailable', 'work_history_gate_lost', 'work_history_invalid_part',
  'work_history_missing_order', 'worker_already_running', 'worker_lease_expired', 'worker_lock_directory_invalid',
  'worker_lock_lost', 'worker_lock_unavailable', 'worker_shutdown', 'handler_failed',
])

/** Read a recent bounded sample and bounded samples of each active state. */
export async function inspectEventQueue(db, { limit = 100, onStage = () => {} } = {}) {
  if (!db || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('invalid_queue_status_options')
  const collection = db.collection('educationEvents')
  onStage('latest')
  const latestSnapshot = await collection.orderBy('createdAt', 'desc').limit(limit + 1).get()
  const latest = latestSnapshot.docs.slice(0, limit).map(projectEvent)
  const active = {}
  for (const state of eventStates) {
    onStage(state)
    const snapshot = await collection.where('state', '==', state).orderBy('createdAt', 'desc').limit(limit + 1).get()
    const docs = snapshot.docs.slice(0, limit)
    active[state] = { sampled: docs.length, truncated: snapshot.docs.length > limit,
      events: docs.map(projectEvent) }
  }
  return {
    collection: 'educationEvents',
    readOnly: true,
    sampleLimit: limit,
    latest: { sampled: latest.length, truncated: latestSnapshot.docs.length > limit, events: latest },
    active,
    scope: 'Bounded samples only; counts are sample sizes, not queue totals.',
  }
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const write = dependencies.write ?? process.stdout.write.bind(process.stdout)
  if (args.length !== 1 || args[0] !== 'status') {
    write('Usage: npm run events:status\n')
    return 2
  }
  let db = dependencies.db ?? null
  let ownsDb = false
  let stage = 'initialize'
  try {
    if (!db) {
      const root = dependencies.root ?? process.cwd()
      const env = dependencies.env ?? process.env
      const projectId = env.TELEGRAM_FIRESTORE_PROJECT_ID ?? env.FIRESTORE_PROJECT_ID
        ?? env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT ?? readFirebaseProject(root)
      if (!projectId) throw safeError('firestore_project_unavailable')
      db = (dependencies.dbFactory ?? createEducationFirestore)({ projectId, cwd: root, env })
      ownsDb = true
    }
    const result = await inspectEventQueue(db, { onStage: (value) => { stage = diagnosticStages.has(value) ? value : 'initialize' } })
    write(`${JSON.stringify(result)}\n`)
    return 0
  } catch (error) {
    const grpcCode = Number.isInteger(error?.code) && error.code >= 0 && error.code <= 16 ? error.code : null
    write(`${JSON.stringify({
      code: safeCode(error?.safeCode) ?? 'education_events_status_failed',
      stage: diagnosticStages.has(stage) ? stage : 'initialize',
      grpcCode,
      retryable: grpcCode !== null && retryableGrpcCodes.has(grpcCode),
    })}\n`)
    return 1
  } finally {
    if (ownsDb) {
      if (typeof db?.terminate === 'function') await db.terminate()
      else await db?.close?.()
    }
  }
}

function projectEvent(doc) {
  const row = doc.data() ?? {}
  const createdAt = safeTimestamp(row.createdAt)
  const claimedAt = safeTimestamp(row.claimedAt)
  const finishedAt = safeTimestamp(row.finishedAt)
  return {
    eventId: /^[a-f0-9]{64}$/.test(doc.id ?? '') ? doc.id : null,
    eventIdHash: hashPointer(doc.id),
    source: row.source === 'firestore' || row.source === 'mesh' ? row.source : 'unknown',
    eventType: eventTypes.has(row.eventType) ? row.eventType : 'unknown',
    state: eventStates.includes(row.state) || row.state === 'complete' ? row.state : 'unknown',
    createdAt,
    claimedAt,
    finishedAt,
    attempts: Number.isSafeInteger(row.attempts) && row.attempts >= 0 ? row.attempts : null,
    safeErrorCode: safeCode(row.safeErrorCode),
    latencyMs: {
      createdToClaimed: createdAt && claimedAt ? Math.max(0, Date.parse(claimedAt) - Date.parse(createdAt)) : null,
      createdToFinished: createdAt && finishedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(createdAt)) : null,
    },
    fanout: projectFanout(row.fanout),
    taskPointers: collectTaskPointers(row),
  }
}

function projectFanout(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  for (const [phase, receipt] of Object.entries(value).slice(0, 24)) {
    if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(phase)) continue
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) continue
    result[phase] = {
      state: ['pending', 'processing', 'complete', 'blocked', 'failed'].includes(receipt.state) ? receipt.state : 'unknown',
      completedAt: safeTimestamp(receipt.completedAt),
      ...(safePointers(receipt)),
    }
  }
  return result
}

function collectTaskPointers(row) {
  const pointers = []
  const scan = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 3) return
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:task|dispatch|action|notice|notification|outbox)(?:Id|Key|Ref)$/i.test(key)
        && (typeof item === 'string' || Number.isSafeInteger(item))) pointers.push({ kind: key.replace(/(?:Id|Key|Ref)$/i, '').toLowerCase(), idHash: hashPointer(item) })
      else if (typeof item === 'object') scan(item, depth + 1)
    }
  }
  scan(row)
  return pointers.slice(0, 32)
}

function safePointers(value) {
  const pointers = {}
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:task|dispatch|action|notice|notification|outbox)(?:Id|Key|Ref)$/i.test(key)
      && (typeof item === 'string' || Number.isSafeInteger(item))) pointers[key] = hashPointer(item)
  }
  return Object.keys(pointers).length ? { pointerHashes: pointers } : {}
}

function safeTimestamp(value) {
  let date
  if (value instanceof Date) date = value
  else if (typeof value === 'string' || typeof value === 'number') date = new Date(value)
  else if (typeof value?.toDate === 'function') {
    try { date = value.toDate() } catch { return null }
  } else if (Number.isFinite(value?.seconds)) date = new Date(value.seconds * 1000 + (value.nanoseconds ?? 0) / 1e6)
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null
  return date.toISOString()
}

function safeCode(value) {
  return typeof value === 'string' && safeErrorCodes.has(value) ? value : null
}
function hashPointer(value) { return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 20) }
function safeError(code) { const error = new Error(code); error.safeCode = code; return error }
function readFirebaseProject(root) {
  try {
    const project = JSON.parse(readFileSync(resolve(root, '.firebaserc'), 'utf8'))?.projects?.default
    return typeof project === 'string' && project ? project : null
  } catch { return null }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main()
