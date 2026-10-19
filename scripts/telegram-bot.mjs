import { pathToFileURL } from 'node:url'
import { loadConfig, loadTelegramConfig, safeFailureCode } from '../packages/telegram-notifications/adapters/config.mjs'
import { createRuntime } from '../packages/telegram-notifications/adapters/runtime.mjs'
import { runWorker } from '../packages/telegram-notifications/adapters/worker-loop.mjs'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'
import { createLegacyMeshCredentialCodec } from '../packages/education-runtime/credentials.mjs'
import { createRotatingJsonlSink, createTelemetryFromEnvironment } from '../packages/education-runtime/telemetry.mjs'
import { acquireWorkerLock } from '../packages/telegram-notifications/operations/process-lock.mjs'
import { createPrivateLogger, sanitizeOperationalLog } from '../packages/telegram-notifications/operations/private-logger.mjs'
import { withOperationDeadline } from '../packages/telegram-notifications/operations/operation-deadline.mjs'

/** @see ../docs/product/notifications.md @see ../docs/services/telegram-bot/README.md @see ../docs/services/telegram-bot/operations.md#развёртывание-и-rollout */
const jsonLog = (level, data = {}) => {
  const row = { level, ...sanitizeOperationalLog(data) }
  process.stdout.write(`${JSON.stringify(row)}\n`)
}
const logger = process.env.TELEGRAM_LOG_DIRECTORY
  ? createPrivateLogger(resolve(process.env.TELEGRAM_LOG_DIRECTORY, 'worker.jsonl'))
  : { info: (data) => jsonLog('info', data), error: (data) => jsonLog('error', data) }

export async function main(args = process.argv.slice(2), options = {}) {
const processLike = options.processLike ?? process
const activeLogger = options.logger ?? logger
const env = options.env ?? process.env
const configLoader = options.configLoader ?? loadConfig
const runtimeFactory = options.runtimeFactory ?? createRuntime
const lockFactory = options.lockFactory ?? acquireWorkerLock
try {
  const parsed = parseBotArguments(args)
  const command = parsed.command
  if (command === 'check') {
    const config = loadTelegramConfig(env)
    const { createTelegramAdapter } = await import('../packages/telegram-notifications/adapters/telegram.mjs')
    // Read-only bot identity check: deliberately no Firestore client is created.
    const telegram = createTelegramAdapter({ token: config.token, identity: { start: async () => ({ code: 'registered' }), requestStop: async () => ({ choices: [] }), confirmStop: async () => ({ code: 'invalid_confirmation' }) }, logger: activeLogger })
    const bot = await telegram.verifyIdentity()
    activeLogger.info({ code: 'telegram_identity_verified', username: bot.username })
    process.exitCode = 0
  } else if (command === 'worker') {
    const workerFlags = parsed.workerFlags
    const config = configLoader(env)
    const root = options.root ?? process.cwd()
    const meshDirectory = resolve(root, config.meshConnectionDirectory)
    const workerLock = await lockFactory({ stateDirectory: resolve(meshDirectory, '.locks'), python: options.pythonPath })
    let runtime = null
    const shutdownController = new AbortController()
    try {
      const telemetryPath = process.env.TELEGRAM_LOG_DIRECTORY
        ? resolve(process.env.TELEGRAM_LOG_DIRECTORY, 'telemetry.jsonl') : resolve(root, '.local/telegram/telemetry.jsonl')
      const telemetry = options.telemetry ?? createTelemetryFromEnvironment({ sink: createRotatingJsonlSink(
        env.TELEGRAM_LOG_DIRECTORY ? resolve(env.TELEGRAM_LOG_DIRECTORY, 'telemetry.jsonl') : telemetryPath) })
      const legacyCodec = options.legacyCodec ?? createLegacyMeshCredentialCodec({
        familyAccessPath: resolve(env.TELEGRAM_FAMILY_ACCESS_PATH ?? resolve(root, '.local/family-access.json')),
        credentialsPath: resolve(env.TELEGRAM_LEGACY_CREDENTIALS_PATH ?? resolve(root, '.local/diary/secret.json')) })
      const diskTokenPath = env.EDUCATION_YANDEX_DISK_TOKEN_FILE || resolve(root, '.local/yandex-disk-token')
      const diskToken = env.YANDEX_DISK_TOKEN || (existsSync(diskTokenPath) ? readFileSync(diskTokenPath, 'utf8').trim() : '')
      if (workerFlags.enableDelivery && !diskToken) throw new Error('upload_storage_credentials_unavailable')
      const uploadDisk = options.uploadDisk ?? (diskToken ? new YandexDiskStorage(diskToken) : null)
      runtime = runtimeFactory({ ...config, meshConnectionDirectory: meshDirectory }, { logger: activeLogger,
        enableFirestoreSource: workerFlags.enableFirestoreSource, enableMeshSource: workerFlags.enableMeshSource,
        enableDelivery: workerFlags.enableDelivery, telemetry, legacyCodec, uploadDisk, shutdownSignal: shutdownController.signal })
      workerLock.assertHeld()
      const startupDeadline = (work) => withOperationDeadline(work, { timeoutMs: config.startupOperationTimeoutMs ?? 600_000,
        operation: 'startup_verify', onTimeout: () => { activeLogger.error({ code: 'startup_operation_timeout' }); processLike.exit(1) } })
      const bot = await startupDeadline(runtime.telegram.verifyIdentity).call(runtime.telegram)
      await startupDeadline(runtime.verifyFirestore).call(runtime)
      activeLogger.info({ code: 'telegram_worker_starting', username: bot.username, deliveryEnabled: workerFlags.enableDelivery,
        firestoreSourceEnabled: workerFlags.enableFirestoreSource, meshSourceEnabled: workerFlags.enableMeshSource })
      workerLock.assertHeld()
      const result = await runWorker({ runtime, enableDelivery: workerFlags.enableDelivery, logger: activeLogger, processLike,
        sourceOperationTimeoutMs: config.sourceOperationTimeoutMs,
        deliveryOperationTimeoutMs: config.deliveryOperationTimeoutMs,
        educationSyncOperationTimeoutMs: config.educationSyncOperationTimeoutMs,
        lock: workerLock, telemetry, onShutdown: () => shutdownController.abort() })
      if (!result.ok) processLike.exitCode = 1
    } catch (error) {
      if (!shutdownController.signal.aborted) shutdownController.abort()
      try { if (runtime?.telegram?.bot?.isRunning()) await runtime.telegram.stop() } catch { activeLogger.error({ code: 'telegram_stop_failed' }) }
      try { await runtime?.db?.terminate?.() } catch { activeLogger.error({ code: 'firestore_shutdown_failed' }) }
      throw error
    } finally {
      await workerLock.release()
    }
  } else {
    process.stderr.write('usage: node scripts/telegram-bot.mjs check|worker [--enable-firestore-source] [--enable-mesh-source] [--enable-delivery]\n')
    process.exitCode = 2
  }
} catch (error) {
  activeLogger.error({ code: safeFailureCode(error) })
  processLike.exitCode = 1
}
}

export function parseBotArguments(args) {
  const [command, ...flags] = args
  if (command === 'check') {
    if (flags.length) throw new Error('worker_flag_unknown')
    return Object.freeze({ command, workerFlags: null })
  }
  if (command === 'worker') return Object.freeze({ command, workerFlags: parseWorkerFlags(flags) })
  return Object.freeze({ command: null, workerFlags: null })
}

export function parseWorkerFlags(flags) {
  const allowed = new Set(['--enable-delivery', '--enable-firestore-source', '--enable-mesh-source'])
  const seen = new Set()
  for (const flag of flags) {
    if (!allowed.has(flag)) throw new Error('worker_flag_unknown')
    if (seen.has(flag)) throw new Error('worker_flag_duplicate')
    seen.add(flag)
  }
  return Object.freeze({ enableDelivery: seen.has('--enable-delivery'),
    enableFirestoreSource: seen.has('--enable-firestore-source'), enableMeshSource: seen.has('--enable-mesh-source') })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
/** @see ../docs/product/notifications.md @see ../docs/services/telegram-bot/operations.md#runtime-boundary */
