import { pathToFileURL } from 'node:url'
import { loadConfig, loadTelegramConfig, safeFailureCode } from '../packages/telegram-notifications/adapters/config.mjs'
import { createRuntime } from '../packages/telegram-notifications/adapters/runtime.mjs'
import { runWorker } from '../packages/telegram-notifications/adapters/worker-loop.mjs'

/** @see ../docs/product/notifications.md @see ../docs/services/telegram-bot/README.md @see ../docs/services/telegram-bot/operations.md#развёртывание-и-rollout */
const jsonLog = (level, data) => process.stdout.write(`${JSON.stringify({ level, ...data })}\n`)
const logger = { info: (data) => jsonLog('info', data), error: (data) => jsonLog('error', data) }

export async function main(args = process.argv.slice(2), { processLike = process } = {}) {
const [command, ...flags] = args
try {
  if (command === 'check') {
    if (flags.length) throw new Error('worker_flag_unknown')
    const config = loadTelegramConfig()
    const { createTelegramAdapter } = await import('../packages/telegram-notifications/adapters/telegram.mjs')
    // Read-only bot identity check: deliberately no Firestore client is created.
    const telegram = createTelegramAdapter({ token: config.token, identity: { start: async () => ({ code: 'registered' }), requestStop: async () => ({ choices: [] }), confirmStop: async () => ({ code: 'invalid_confirmation' }) }, logger })
    const bot = await telegram.verifyIdentity()
    logger.info({ code: 'telegram_identity_verified', username: bot.username })
    process.exitCode = 0
  } else if (command === 'worker') {
    const workerFlags = parseWorkerFlags(flags)
    const config = loadConfig()
    const runtime = createRuntime(config, { logger, enableFirestoreSource: workerFlags.enableFirestoreSource,
      enableMeshSource: workerFlags.enableMeshSource, enableDelivery: workerFlags.enableDelivery })
    try {
      const bot = await runtime.telegram.verifyIdentity()
      await runtime.verifyFirestore()
      logger.info({ code: 'telegram_worker_starting', username: bot.username, deliveryEnabled: workerFlags.enableDelivery,
        firestoreSourceEnabled: workerFlags.enableFirestoreSource, meshSourceEnabled: workerFlags.enableMeshSource })
      const result = await runWorker({ runtime, enableDelivery: workerFlags.enableDelivery, logger, processLike })
      if (!result.ok) processLike.exitCode = 1
    } catch (error) {
      try { if (runtime.telegram.bot.isRunning()) await runtime.telegram.stop() } catch { logger.error({ code: 'telegram_stop_failed' }) }
      try { await runtime.db.terminate() } catch { logger.error({ code: 'firestore_shutdown_failed' }) }
      throw error
    }
  } else {
    process.stderr.write('usage: node scripts/telegram-bot.mjs check|worker [--enable-firestore-source] [--enable-mesh-source] [--enable-delivery]\n')
    process.exitCode = 2
  }
} catch (error) {
  logger.error({ code: safeFailureCode(error) })
  processLike.exitCode = 1
}
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
