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
    const config = loadTelegramConfig()
    const { createTelegramAdapter } = await import('../packages/telegram-notifications/adapters/telegram.mjs')
    // Read-only bot identity check: deliberately no Firestore client is created.
    const telegram = createTelegramAdapter({ token: config.token, identity: { start: async () => ({ code: 'registered' }), requestStop: async () => ({ choices: [] }), confirmStop: async () => ({ code: 'invalid_confirmation' }) }, logger })
    const bot = await telegram.verifyIdentity()
    logger.info({ code: 'telegram_identity_verified', username: bot.username })
    process.exitCode = 0
  } else if (command === 'worker') {
    const config = loadConfig()
    const runtime = createRuntime(config, { logger })
    try {
      const bot = await runtime.telegram.verifyIdentity()
      await runtime.verifyFirestore()
      logger.info({ code: 'telegram_worker_starting', username: bot.username, deliveryEnabled: flags.includes('--enable-delivery') })
      // No source observers are installed in this increment. Delivery can only
      // drain jobs already present in the ledger and is off unless explicitly enabled.
      const result = await runWorker({ runtime, enableDelivery: flags.includes('--enable-delivery'), logger, processLike })
      if (!result.ok) processLike.exitCode = 1
    } catch (error) {
      try { if (runtime.telegram.bot.isRunning()) await runtime.telegram.stop() } catch { logger.error({ code: 'telegram_stop_failed' }) }
      try { await runtime.db.terminate() } catch { logger.error({ code: 'firestore_shutdown_failed' }) }
      throw error
    }
  } else {
    process.stderr.write('usage: node scripts/telegram-bot.mjs check|worker [--enable-delivery]\n')
    process.exitCode = 2
  }
} catch (error) {
  logger.error({ code: safeFailureCode(error) })
  processLike.exitCode = 1
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
/** @see ../docs/product/notifications.md @see ../docs/services/telegram-bot/operations.md#runtime-boundary */
