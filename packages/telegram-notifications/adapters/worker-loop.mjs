/** @see ../../../docs/services/telegram-bot/operations.md#runtime-boundary */
export async function runWorker({ runtime, enableDelivery, logger, processLike = process, random = Math.random, shutdownMs = 25_000 }) {
  let running = true
  let stopPromise
  let drainTask = Promise.resolve()
  let pollTask = Promise.resolve()
  let wakeIdle
  let failure = false
  let requestShutdown
  const shutdownRequested = new Promise((resolve) => { requestShutdown = resolve })
  const stop = () => {
    if (stopPromise) return stopPromise
    running = false
    wakeIdle?.()
    requestShutdown()
    stopPromise = (async () => {
      let timedOut = false
      let timer
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => { timedOut = true; resolve(false) }, shutdownMs)
        timer.unref?.()
      })
      try {
        if (runtime.telegram.bot.isRunning()) {
          const stopResult = await Promise.race([
            runtime.telegram.stop().then(() => true, () => { failure = true; logger.error({ code: 'telegram_stop_failed' }); return true }),
            deadline,
          ])
          if (!stopResult) timedOut = true
        }
      } catch {
        failure = true
        logger.error({ code: 'telegram_stop_failed' })
      }
      if (!timedOut) {
        const drained = await Promise.race([Promise.allSettled([drainTask, pollTask]).then(() => true), deadline])
        if (!drained) timedOut = true
      }
      if (timedOut) { failure = true; logger.error({ code: 'shutdown_deadline_exceeded' }) }
      try {
        const terminated = await Promise.race([runtime.db.terminate().then(() => true, () => false), deadline])
        if (!terminated) { failure = true; logger.error({ code: 'firestore_shutdown_failed' }) }
      } catch { failure = true; logger.error({ code: 'firestore_shutdown_failed' }) }
      clearTimeout(timer)
      if (failure && typeof processLike.exit === 'function') processLike.exit(1)
      return !failure
    })()
    return stopPromise
  }

  const onSignal = () => { void stop().catch(() => { failure = true; logger.error({ code: 'shutdown_failed' }) }) }
  processLike.once('SIGINT', onSignal)
  processLike.once('SIGTERM', onSignal)
  try {
    if (enableDelivery) {
      drainTask = (async () => {
        let idleMs = 1_000
        while (running) {
          const didWork = await runtime.notificationService.runOne()
          if (didWork) idleMs = 1_000
          else {
            const jitter = Math.floor(random() * Math.max(1, idleMs / 5))
            await new Promise((resolve) => {
              let settled = false
              const finish = () => { if (settled) return; settled = true; clearTimeout(timer); wakeIdle = null; resolve() }
              const timer = setTimeout(finish, idleMs + jitter)
              timer.unref?.()
              wakeIdle = finish
            })
            idleMs = Math.min(60_000, idleMs * 2)
          }
        }
      })().catch(() => { failure = true; running = false; logger.error({ code: 'outbox_loop_failed' }); wakeIdle?.(); void stop() })
    }
    pollTask = Promise.resolve().then(() => runtime.telegram.start())
    await Promise.race([pollTask, shutdownRequested])
  } catch {
    failure = true
    logger.error({ code: 'telegram_polling_failed' })
  } finally {
    processLike.removeListener('SIGINT', onSignal)
    processLike.removeListener('SIGTERM', onSignal)
    await stop()
  }
  return { ok: !failure }
}
