/** @see ../../../docs/services/telegram-bot/operations.md#конфигурация */
export function loadConfig(env = process.env) {
  return Object.freeze({ ...loadTelegramConfig(env), projectId: requiredProject(env), instanceId: workerId(env) })
}

export function loadTelegramConfig(env = process.env) {
  const token = env.AGI_EDU_BOT
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

const SAFE_CODES = new Set(['bot_token_missing', 'bot_token_invalid', 'firestore_project_missing', 'worker_id_invalid', 'telegram_identity_mismatch', 'dependency_unavailable', 'private_chat_required', 'invalid_sender', 'startup_failed'])
export function safeFailureCode(error) { return SAFE_CODES.has(error?.message) ? error.message : 'startup_failed' }
