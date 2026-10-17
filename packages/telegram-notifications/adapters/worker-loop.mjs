/** @see ../../../docs/services/telegram-bot/operations.md#runtime-boundary */
export async function runWorker({ runtime, enableDelivery, logger, processLike = process, random = Math.random,
  shutdownMs = 25_000, shutdownCleanupMs = 5_000, lock = null, telemetry = null, onShutdown = null }) {
  let running = true
  let stopPromise
  let drainTask = Promise.resolve()
  let pollTask = Promise.resolve()
  let sourceTask = Promise.resolve()
  let sourceCloseTask = Promise.resolve()
  let pollStartAttempted = false
  let wakeIdle
  let failure = false
  let requestShutdown
  const shutdownRequested = new Promise((resolve) => { requestShutdown = resolve })
  const lockMonitor = lock?.lost?.then((error) => {
    if (error) {
      failure = true
      logger.error({ code: 'worker_lock_lost' })
      void stop().catch(() => { failure = true; logger.error({ code: 'shutdown_failed' }) })
    }
  })
  const stop = () => {
    if (stopPromise) return stopPromise
    running = false
    wakeIdle?.()
    requestShutdown()
    try { onShutdown?.() } catch { failure = true; logger.error({ code: 'shutdown_signal_failed' }) }
    sourceCloseTask = Promise.resolve().then(() => runtime.sourceCoordinator?.close?.()).catch(() => {
      failure = true
      logger.error({ code: 'source_stop_failed' })
    })
    stopPromise = (async () => {
      let timedOut = false
      let timer, cleanupTimer
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => { timedOut = true; resolve(false) }, shutdownMs)
        timer.unref?.()
      })
      const stages = [
        ...(runtime.telegram.bot.isRunning() || pollStartAttempted ? [['telegram_stop', () => runtime.telegram.stop()]] : []),
        ['source_close', () => sourceCloseTask], ['source_start', () => sourceTask],
        ['delivery_drain', () => drainTask], ['telegram_poll', () => pollTask],
      ]
      const stageResults = await Promise.all(stages.map(async ([stage, work]) => {
        try {
          const completed = await runShutdownStage(telemetry, stage, work, deadline)
          if (!completed) logger.error({ code: `shutdown_timeout_${stage}` })
          return completed
        } catch {
          failure = true
          logger.error({ code: stage === 'telegram_stop' ? 'telegram_stop_failed' : `shutdown_stage_failed_${stage}` })
          return true
        }
      }))
      timedOut = stageResults.includes(false)
      if (timedOut) { failure = true; logger.error({ code: 'shutdown_deadline_exceeded' }) }
      try {
        const cleanupDeadline = new Promise((resolve) => {
          cleanupTimer = setTimeout(() => resolve(false), shutdownCleanupMs)
          cleanupTimer.unref?.()
        })
        const terminated = await runShutdownStage(telemetry, 'firestore_terminate', () => runtime.db.terminate(), cleanupDeadline)
        if (!terminated) { failure = true; logger.error({ code: 'shutdown_timeout_firestore_terminate' }) }
      } catch { failure = true; logger.error({ code: 'firestore_shutdown_failed' }) }
      clearTimeout(timer)
      if (cleanupTimer) clearTimeout(cleanupTimer)
      if (failure && typeof processLike.exit === 'function') processLike.exit(1)
      return !failure
    })()
    return stopPromise
  }

  const onSignal = () => { void stop().catch(() => { failure = true; logger.error({ code: 'shutdown_failed' }) }) }
  processLike.once('SIGINT', onSignal)
  processLike.once('SIGTERM', onSignal)
  try {
    sourceTask = Promise.resolve().then(async () => {
      if (!running) return
      await runtime.sourceCoordinator?.start?.()
    }).catch(() => {
      failure = true
      logger.error({ code: 'source_start_failed' })
      wakeIdle?.()
      void stop().catch(() => { failure = true; logger.error({ code: 'shutdown_failed' }) })
    })
    if (enableDelivery) {
      drainTask = Promise.resolve().then(async () => {
        let loopIdleMs = 1_000
        while (running) {
          const didWork = await runtime.notificationService.runOne()
          if (!running) break
          if (didWork) loopIdleMs = 1_000
          else {
            const jitter = Math.floor(random() * Math.max(1, loopIdleMs / 5))
            await new Promise((resolve) => {
              let settled = false
              const finish = () => { if (settled) return; settled = true; clearTimeout(timer); wakeIdle = null; resolve() }
              const timer = setTimeout(finish, loopIdleMs + jitter)
              timer.unref?.()
              wakeIdle = finish
            })
            loopIdleMs = Math.min(60_000, loopIdleMs * 2)
          }
        }
      }).catch(() => { failure = true; logger.error({ code: 'outbox_loop_failed' }); wakeIdle?.(); void stop().catch(() => { failure = true; logger.error({ code: 'shutdown_failed' }) }) })
    }
    pollTask = Promise.resolve().then(async () => {
      if (!running) return
      pollStartAttempted = true
      await runtime.telegram.start()
    }).catch(() => {
      failure = true
      logger.error({ code: 'telegram_polling_failed' })
      void stop().catch(() => { failure = true; logger.error({ code: 'shutdown_failed' }) })
    })
    await Promise.race([Promise.all([sourceTask, pollTask]), shutdownRequested, ...(lockMonitor ? [lockMonitor] : [])])
  } catch {
    failure = true
    logger.error({ code: 'worker_start_failed' })
  } finally {
    processLike.removeListener('SIGINT', onSignal)
    processLike.removeListener('SIGTERM', onSignal)
    await stop()
    try { lock?.assertHeld?.() } catch { failure = true }
  }
  return { ok: !failure }
}

async function runShutdownStage(telemetry, stage, work, deadline) {
  const operation = `telegram.shutdown.${stage}`
  const measured = async () => {
    const result = await Promise.race([
      Promise.resolve().then(work).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error })),
      deadline.then(() => ({ timeout: true })),
    ])
    if (result?.timeout) throw Object.assign(new Error('shutdown_stage_timeout'), { safeCode: 'shutdown_stage_timeout' })
    if (!result.ok) throw result.error
    return result.value
  }
  if (!telemetry?.span) return measured().then(() => true, (error) => {
    if (error?.safeCode === 'shutdown_stage_timeout') return false
    throw error
  })
  try { await telemetry.span(operation, measured, { stage }); return true }
  catch (error) {
    if (error?.safeCode === 'shutdown_stage_timeout') return false
    throw error
  }
}
