/** @see ../../../docs/services/telegram-bot/operations.md#runtime-boundary */
import { withOperationDeadline } from '../operations/operation-deadline.mjs'

export async function runWorker({ runtime, enableDelivery, logger, processLike = process, random = Math.random,
  shutdownMs = 25_000, shutdownCleanupMs = 5_000, sourceOperationTimeoutMs = 600_000,
  deliveryOperationTimeoutMs = 600_000, educationSyncOperationTimeoutMs = 60_000,
  educationEventOperationTimeoutMs = 600_000,
  lock = null, telemetry = null, onShutdown = null }) {
  let running = true
  let stopPromise
  let drainTask = Promise.resolve()
  let educationSyncTask = Promise.resolve()
  let educationEventTask = Promise.resolve()
  let educationEventCloseTask = Promise.resolve()
  let uploadReconcileTask = Promise.resolve()
  let uploadReconcileCloseTask = Promise.resolve()
  let pollTask = Promise.resolve()
  let sourceTask = Promise.resolve()
  let sourceCloseTask = Promise.resolve()
  let pollStartAttempted = false
  const idleWakers = new Set()
  const wakeIdle = () => { for (const wake of [...idleWakers]) wake() }
  const deliveryWake = createDueWake()
  const educationSyncWake = createDueWake()
  runtime.setWorkerWakeHandlers?.({ delivery: (dueAt) => deliveryWake.signal(dueAt), educationSync: (dueAt) => educationSyncWake.signal(dueAt) })
  let failure = false
  let requestShutdown
  const shutdownRequested = new Promise((resolve) => { requestShutdown = resolve })
  const onOperationTimeout = (operation) => {
    failure = true
    const code = operation === 'delivery_run_one' ? 'delivery_operation_timeout'
      : operation === 'education_sync_dispatch' ? 'education_sync_dispatch_timeout' : 'source_operation_timeout'
    logger.error({ code })
    // Process termination is the cancellation boundary: SDK/transport work may
    // not support AbortSignal, so it must not continue into a replacement run.
    if (typeof processLike.exit === 'function') processLike.exit(1)
    else processLike.exitCode = 1
  }
  const guardSourceOperations = () => {
    const coordinator = runtime.sourceCoordinator
    if (!coordinator) return
    for (const [name, operation] of [['reconcile', 'source_reconcile'], ['start', 'source_start']]) {
      const original = coordinator[name]
      if (typeof original === 'function' && !original.__workerWatchdog && !original.__operationDeadline) {
        const wrapped = withOperationDeadline(original, { timeoutMs: sourceOperationTimeoutMs, operation, onTimeout: onOperationTimeout })
        Object.defineProperty(wrapped, '__workerWatchdog', { value: true })
        coordinator[name] = wrapped
      }
    }
    for (const pipeline of Object.values(coordinator.pipelines ?? {})) {
      const original = pipeline?.process
      if (typeof original === 'function' && !original.__workerWatchdog && !original.__operationDeadline) {
        const wrapped = withOperationDeadline(original, { timeoutMs: sourceOperationTimeoutMs, operation: 'source_pipeline', onTimeout: onOperationTimeout })
        Object.defineProperty(wrapped, '__workerWatchdog', { value: true })
        pipeline.process = wrapped
      }
    }
  }
  guardSourceOperations()
  if (enableDelivery && typeof runtime.notificationService?.runOne === 'function'
    && !runtime.notificationService.runOne.__workerWatchdog && !runtime.notificationService.runOne.__operationDeadline) {
    const wrapped = withOperationDeadline(runtime.notificationService.runOne, {
      timeoutMs: deliveryOperationTimeoutMs, operation: 'delivery_run_one', onTimeout: onOperationTimeout })
    Object.defineProperty(wrapped, '__workerWatchdog', { value: true })
    runtime.notificationService.runOne = wrapped
  }
  if (typeof runtime.educationEventConsumer?.runOne === 'function'
    && !runtime.educationEventConsumer.runOne.__workerWatchdog && !runtime.educationEventConsumer.runOne.__operationDeadline) {
    const wrapped = withOperationDeadline(runtime.educationEventConsumer.runOne, {
      timeoutMs: educationEventOperationTimeoutMs, operation: 'education_event_dispatch', onTimeout: onOperationTimeout,
    })
    Object.defineProperty(wrapped, '__workerWatchdog', { value: true })
    runtime.educationEventConsumer.runOne = wrapped
  }
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
    deliveryWake.clear()
    educationSyncWake.clear()
    runtime.setWorkerWakeHandlers?.({})
    requestShutdown()
    try { onShutdown?.() } catch { failure = true; logger.error({ code: 'shutdown_signal_failed' }) }
    sourceCloseTask = Promise.resolve().then(() => runtime.sourceCoordinator?.close?.()).catch(() => {
      failure = true
      logger.error({ code: 'source_stop_failed' })
    })
    educationEventCloseTask = Promise.resolve().then(() => runtime.educationEventConsumer?.close?.()).catch(() => {
      failure = true
      logger.error({ code: 'education_event_consumer_stop_failed' })
    })
    uploadReconcileCloseTask = Promise.all([runtime.uploadReconciler?.stop?.(), runtime.legacyEventReconciler?.stop?.()]).catch(() => {
      failure = true
      logger.error({ code: 'upload_reconciliation_stop_failed' })
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
        ['source_close', () => sourceCloseTask], ['education_event_drain', () => educationEventCloseTask],
        ['upload_reconciliation_stop', () => uploadReconcileCloseTask], ['upload_reconciliation_start', () => uploadReconcileTask],
        ['education_event_start', () => educationEventTask], ['source_start', () => sourceTask],
        ['delivery_drain', () => drainTask], ['education_sync_dispatch', () => educationSyncTask], ['telegram_poll', () => pollTask],
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
    educationEventTask = Promise.resolve().then(async () => {
      if (!running) return
      await runtime.educationEventConsumer?.start?.()
    }).catch(() => {
      failure = true
      logger.error({ code: 'education_event_consumer_start_failed' })
      wakeIdle?.()
      void stop().catch(() => { failure = true; logger.error({ code: 'shutdown_failed' }) })
    })
    uploadReconcileTask = Promise.resolve().then(async () => {
      if (!running || !enableDelivery) return
      await Promise.all([runtime.uploadReconciler?.start?.(), runtime.legacyEventReconciler?.start?.()])
    }).catch(() => {
      failure = true
      logger.error({ code: 'upload_reconciliation_start_failed' })
      wakeIdle?.()
      void stop().catch(() => { failure = true; logger.error({ code: 'shutdown_failed' }) })
    })
    if (enableDelivery) {
      drainTask = Promise.resolve().then(async () => {
        let loopIdleMs = 1_000
        while (running) {
          const wakeVersion = deliveryWake.version()
          const didWork = await runtime.notificationService.runOne()
          if (!running) break
          if (didWork) loopIdleMs = 1_000
          else {
            const jitter = Math.floor(random() * Math.max(1, loopIdleMs / 5))
            await deliveryWake.wait(loopIdleMs + jitter, idleWakers, wakeVersion)
            loopIdleMs = Math.min(60_000, loopIdleMs * 2)
          }
        }
      }).catch(() => { failure = true; logger.error({ code: 'outbox_loop_failed' }); wakeIdle?.(); void stop().catch(() => { failure = true; logger.error({ code: 'shutdown_failed' }) }) })
    }
    if (typeof runtime.educationSyncDispatcher?.runOne === 'function') {
      const dispatcher = runtime.educationSyncDispatcher
      if (!dispatcher.runOne.__workerWatchdog && !dispatcher.runOne.__operationDeadline) {
        const wrapped = withOperationDeadline(dispatcher.runOne, {
          timeoutMs: educationSyncOperationTimeoutMs,
          operation: 'education_sync_dispatch', onTimeout: onOperationTimeout,
        })
        Object.defineProperty(wrapped, '__workerWatchdog', { value: true })
        dispatcher.runOne = wrapped
      }
      educationSyncTask = Promise.resolve().then(async () => {
        let loopIdleMs = 1_000
        while (running) {
          const wakeVersion = educationSyncWake.version()
          const didWork = await dispatcher.runOne()
          if (!running) break
          if (didWork) loopIdleMs = 1_000
          else {
            const jitter = Math.floor(random() * Math.max(1, loopIdleMs / 5))
            await educationSyncWake.wait(loopIdleMs + jitter, idleWakers, wakeVersion)
            loopIdleMs = Math.min(60_000, loopIdleMs * 2)
          }
        }
      }).catch(() => { failure = true; logger.error({ code: 'education_sync_dispatch_failed' }); wakeIdle?.(); void stop().catch(() => { failure = true; logger.error({ code: 'shutdown_failed' }) }) })
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

function createDueWake(clock = Date.now) {
  let generation = 0
  let closed = false
  const dueTimes = new Set()
  const waiters = new Set()
  return {
    version() { return generation },
    signal(value) {
      if (closed) return
      generation += 1
      const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
      if (Number.isFinite(parsed)) dueTimes.add(parsed)
      for (const resolve of [...waiters]) resolve('signal')
    },
    async wait(fallbackMs, sharedWakers, observed = generation) {
      let earliest = Infinity
      let expiredHint = false
      for (const due of dueTimes) {
        if (due <= clock()) { dueTimes.delete(due); expiredHint = true }
        else if (due < earliest) earliest = due
      }
      // If an in-flight runOne crossed a due deadline, immediately recheck once.
      // The hint is consumed here, so a stale hint cannot create a hot loop.
      if (expiredHint) return
      if (generation !== observed) return
      const deadline = Math.max(0, earliest - clock())
      const timeoutMs = Math.min(fallbackMs, deadline)
      if (timeoutMs === 0) return
      await new Promise((resolve) => {
        let settled = false
        const finish = (reason) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          waiters.delete(onSignal)
          sharedWakers.delete(onSignal)
          if (reason === 'due') for (const due of dueTimes) if (due <= clock()) dueTimes.delete(due)
          resolve()
        }
        const onSignal = () => finish('signal')
        const timer = setTimeout(() => finish(deadline <= fallbackMs ? 'due' : 'fallback'), timeoutMs)
        timer.unref?.()
        waiters.add(onSignal)
        sharedWakers.add(onSignal)
        if (generation !== observed) onSignal()
      })
    },
    clear() { closed = true; dueTimes.clear(); generation += 1 },
  }
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
