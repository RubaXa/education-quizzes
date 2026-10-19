import { readFileSync, statSync } from 'node:fs'

/** @see ../../../docs/services/telegram-bot/operations.md#конфигурация */
export function loadConfig(env = process.env) {
  return Object.freeze({ ...loadTelegramConfig(env), projectId: requiredProject(env), instanceId: workerId(env),
    educationSync: educationSyncConfig(env),
    startupOperationTimeoutMs: boundedInteger(env.TELEGRAM_STARTUP_OPERATION_TIMEOUT_MS, 600_000, 30_000, 86_400_000, 'startup_operation_timeout_invalid'),
    sourcePageSize: boundedInteger(env.TELEGRAM_SOURCE_PAGE_SIZE, 250, 1, 1000, 'source_page_size_invalid'),
    sourceConcurrency: boundedInteger(env.TELEGRAM_SOURCE_CONCURRENCY, 4, 1, 128, 'source_concurrency_invalid'),
    eventConcurrency: boundedInteger(env.TELEGRAM_EVENT_CONCURRENCY, 4, 1, 16, 'event_concurrency_invalid'),
    sourceReconcileMs: boundedInteger(env.TELEGRAM_SOURCE_RECONCILE_MS, 30_000, 5_000, 3_600_000, 'source_reconcile_interval_invalid'),
    sourceOperationTimeoutMs: boundedInteger(env.TELEGRAM_SOURCE_OPERATION_TIMEOUT_MS, 600_000, 30_000, 86_400_000, 'source_operation_timeout_invalid'),
    deliveryOperationTimeoutMs: boundedInteger(env.TELEGRAM_DELIVERY_OPERATION_TIMEOUT_MS, 600_000, 30_000, 86_400_000, 'delivery_operation_timeout_invalid'),
    educationSyncOperationTimeoutMs: boundedInteger(env.TELEGRAM_EDUCATION_SYNC_OPERATION_TIMEOUT_MS, 60_000, 1_000, 600_000, 'education_sync_operation_timeout_invalid'),
    meshPollMs: boundedInteger(env.TELEGRAM_MESH_POLL_MS, 900_000, 60_000, 86_400_000, 'mesh_poll_interval_invalid'),
    meshConnectionDirectory: connectionDirectory(env.TELEGRAM_MESH_CONNECTION_DIRECTORY),
  })
}

function educationSyncConfig(env) {
  const codexPath = env.EDUCATION_SYNC_CODEX_PATH
  const threadId = env.EDUCATION_SYNC_THREAD_ID
  if (!codexPath && !threadId) return null
  if (typeof codexPath !== 'string' || !codexPath.startsWith('/') || codexPath.includes('\0')) throw new Error('education_sync_config_invalid')
  if (typeof threadId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(threadId)) throw new Error('education_sync_config_invalid')
  const remote = env.EDUCATION_SYNC_REMOTE ?? null
  if (remote !== null && (typeof remote !== 'string' || !remote.startsWith('unix://') || remote.includes('\0'))) throw new Error('education_sync_config_invalid')
  const projectRoot = env.EDUCATION_SYNC_PROJECT_ROOT
  if (typeof projectRoot !== 'string' || !projectRoot.startsWith('/') || projectRoot.includes('\0')) throw new Error('education_sync_config_invalid')
  return Object.freeze({ codexPath, threadId, remote, projectRoot })
}

export function loadTelegramConfig(env = process.env) {
  let token = env.AGI_EDU_BOT
  if (!token && typeof env.TELEGRAM_TOKEN_FILE === 'string' && env.TELEGRAM_TOKEN_FILE.trim()) {
    try {
      const info = statSync(env.TELEGRAM_TOKEN_FILE)
      if (!info.isFile() || (info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
        throw new Error('token_file_permissions_invalid')
      }
      token = readFileSync(env.TELEGRAM_TOKEN_FILE, 'utf8').trim()
    }
    catch { throw new Error('bot_token_missing') }
  }
  if (typeof token !== 'string' || !token.trim()) throw new Error('bot_token_missing')
  if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('bot_token_invalid')
  return Object.freeze({ token })
}

function requiredProject(env) {
  const projectId = env.TELEGRAM_FIRESTORE_PROJECT_ID
  if (typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) throw new Error('firestore_project_missing')
  return projectId
}

function workerId(env) {
  const instanceId = env.TELEGRAM_WORKER_ID ?? `telegram-${process.pid}`
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(instanceId)) throw new Error('worker_id_invalid')
  return instanceId
}

const SAFE_CODES = new Set(['bot_token_missing', 'bot_token_invalid', 'firestore_project_missing', 'worker_id_invalid', 'telegram_identity_mismatch', 'dependency_unavailable', 'private_chat_required', 'invalid_sender', 'startup_failed', 'source_adapter_unavailable', 'source_page_size_invalid', 'source_concurrency_invalid', 'event_concurrency_invalid', 'source_reconcile_interval_invalid', 'source_operation_timeout_invalid', 'delivery_operation_timeout_invalid', 'education_sync_operation_timeout_invalid', 'startup_operation_timeout_invalid', 'mesh_poll_interval_invalid', 'mesh_connection_directory_invalid', 'education_sync_config_invalid', 'worker_flag_unknown', 'worker_flag_duplicate'])
export function safeFailureCode(error) { return SAFE_CODES.has(error?.message) ? error.message : 'startup_failed' }

function boundedInteger(value, fallback, min, max, code) {
  if (value == null || value === '') return fallback
  if (!/^[0-9]+$/.test(String(value))) throw new Error(code)
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(code)
  return number
}

function connectionDirectory(value) {
  const directory = value ?? '.local/mesh-connections'
  if (typeof directory !== 'string' || !directory.trim() || directory.includes('\0')) throw new Error('mesh_connection_directory_invalid')
  return directory
}
