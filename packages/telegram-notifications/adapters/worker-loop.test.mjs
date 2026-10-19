import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runWorker } from './worker-loop.mjs'

const logger = { info() {}, error: vi.fn() }

describe('worker source lifecycle', () => {
  it('requests process replacement when a source reconciliation remains active past its operation deadline', async () => {
    vi.useFakeTimers()
    const processLike = new EventEmitter()
    processLike.exit = vi.fn()
    const events = []
    let finishStart
    const runtime = {
      sourceCoordinator: { start() { return new Promise((resolve) => { finishStart = resolve }) }, async close() { events.push('source-close') } },
      telegram: { bot: { isRunning: () => false }, async start() {}, async stop() {} },
      db: { async terminate() { events.push('db-terminate') } },
    }
    const running = runWorker({ runtime, enableDelivery: false, logger, processLike, sourceOperationTimeoutMs: 25 })
    await vi.waitFor(() => expect(finishStart).toBeTypeOf('function'))
    await vi.advanceTimersByTimeAsync(25)
    expect(processLike.exit).toHaveBeenCalledWith(1)
    expect(logger.error).toHaveBeenCalledWith({ code: 'source_operation_timeout' })
    // The fake exit does not terminate Node; release the promise to let this unit test clean up.
    finishStart()
    processLike.emit('SIGTERM')
    await running
    expect(events).toContain('db-terminate')
  })

  it('requests process replacement when a delivery operation remains active past its deadline', async () => {
    vi.useFakeTimers()
    const processLike = new EventEmitter()
    processLike.exit = vi.fn()
    let finishDelivery
    let finishTelegram
    const runtime = {
      sourceCoordinator: { async start() {}, async close() {} },
      notificationService: { runOne: () => new Promise((resolve) => { finishDelivery = resolve }) },
      telegram: { bot: { isRunning: () => true }, async start() { await new Promise((resolve) => { finishTelegram = resolve }) },
        async stop() { finishTelegram() } },
      db: { async terminate() {} },
    }
    const running = runWorker({ runtime, enableDelivery: true, logger, processLike, deliveryOperationTimeoutMs: 25 })
    await vi.waitFor(() => expect(finishDelivery).toBeTypeOf('function'))
    await vi.advanceTimersByTimeAsync(25)
    expect(processLike.exit).toHaveBeenCalledWith(1)
    expect(logger.error).toHaveBeenCalledWith({ code: 'delivery_operation_timeout' })
    // The fake exit does not enforce process isolation; only a real exit prevents a late write.
    finishDelivery(false)
    processLike.emit('SIGTERM')
    await running
  })

  it('runs the education-sync dispatcher independently and gives its active claim a bounded deadline', async () => {
    vi.useFakeTimers()
    const processLike = new EventEmitter()
    processLike.exit = vi.fn()
    let finishDispatch
    let finishTelegram
    const runtime = {
      sourceCoordinator: { async start() {}, async close() {} },
      educationSyncDispatcher: { runOne: () => new Promise((resolve) => { finishDispatch = resolve }) },
      telegram: { bot: { isRunning: () => true }, async start() { await new Promise((resolve) => { finishTelegram = resolve }) },
        async stop() { finishTelegram() } },
      db: { async terminate() {} },
    }
    const running = runWorker({ runtime, enableDelivery: false, logger, processLike, educationSyncOperationTimeoutMs: 25 })
    await vi.waitFor(() => expect(finishDispatch).toBeTypeOf('function'))
    await vi.advanceTimersByTimeAsync(25)
    expect(processLike.exit).toHaveBeenCalledWith(1)
    expect(logger.error).toHaveBeenCalledWith({ code: 'education_sync_dispatch_timeout' })
    finishDispatch(false)
    processLike.emit('SIGTERM')
    await running
  })

  it('terminates a real worker before a timed-out operation can perform a late write', () => {
    const root = mkdtempSync(join(tmpdir(), 'telegram-worker-deadline-'))
    const marker = join(root, 'late-write')
    try {
      const workerUrl = new URL('./worker-loop.mjs', import.meta.url).href
      const script = `
        import { writeFileSync } from 'node:fs'
        const { runWorker } = await import(${JSON.stringify(workerUrl)})
        const runtime = {
          sourceCoordinator: { start() { setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'late'), 150); return new Promise(() => {}) }, async close() {} },
          telegram: { bot: { isRunning: () => false }, start() { return new Promise(() => {}) }, async stop() {} },
          db: { async terminate() {} },
        }
        await runWorker({ runtime, enableDelivery: false, logger: { info() {}, error() {} }, sourceOperationTimeoutMs: 25 })
      `
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 2_000 })
      expect(child.error).toBeUndefined()
      expect(child.status).toBe(1)
      expect(existsSync(marker)).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('starts source initialization and Telegram concurrently, then drains before database shutdown', async () => {
    const events = []
    const processLike = new EventEmitter()
    let finishTelegram
    const runtime = {
      sourceCoordinator: { async start() { events.push('source-start') }, async close() { events.push('source-close') } },
      telegram: { bot: { isRunning: () => true }, async start() { events.push('telegram-start'); await new Promise((resolve) => { finishTelegram = resolve }) },
        async stop() { finishTelegram(); events.push('telegram-stop') } },
      db: { async terminate() { events.push('db-terminate') } },
    }
    const running = runWorker({ runtime, enableDelivery: false, logger, processLike })
    await vi.waitFor(() => expect(events).toContain('telegram-start'))
    processLike.emit('SIGTERM')
    await expect(running).resolves.toEqual({ ok: true })
    expect(events.indexOf('source-start')).toBeLessThan(events.indexOf('telegram-start'))
    expect(events.indexOf('source-close')).toBeLessThan(events.indexOf('db-terminate'))
  })

  it('keeps Telegram and delivery available while source inventory is pending, then drains on SIGTERM', async () => {
    const processLike = new EventEmitter()
    const events = []
    let finishStart
    const startGate = new Promise((resolve) => { finishStart = resolve })
    let finishClose
    const closeGate = new Promise((resolve) => { finishClose = resolve })
    let telegramRunning = false
    const runtime = {
      sourceCoordinator: { async start() { events.push('source-start'); await startGate }, async close() { events.push('source-close'); await closeGate } },
      telegram: { bot: { isRunning: () => telegramRunning }, async start() { telegramRunning = true; events.push('telegram-start') }, async stop() { telegramRunning = false; events.push('telegram-stop') } },
      notificationService: { async runOne() { events.push('outbox-run'); return false } },
      db: { async terminate() { events.push('db-terminate') } },
    }
    const running = runWorker({ runtime, enableDelivery: true, logger, processLike })
    await vi.waitFor(() => expect(events).toContain('source-start'))
    await vi.waitFor(() => expect(events).toContain('telegram-start'))
    await vi.waitFor(() => expect(events).toContain('outbox-run'))
    expect(events).not.toContain('source-close')
    processLike.emit('SIGTERM')
    await vi.waitFor(() => expect(events).toContain('source-close'))
    finishStart()
    finishClose()
    await expect(running).resolves.toEqual({ ok: true })
    expect(events.at(-1)).toBe('db-terminate')
  })

  it('logs source startup rejection, stops promptly, and terminates the database', async () => {
    const processLike = new EventEmitter()
    const events = []
    const runtime = {
      sourceCoordinator: { async start() { throw new Error('private startup failure') }, async close() { events.push('source-close') } },
      telegram: { bot: { isRunning: () => false }, async start() { events.push('telegram-start') }, async stop() { events.push('telegram-stop') } },
      db: { async terminate() { events.push('db-terminate') } },
    }
    await expect(runWorker({ runtime, enableDelivery: false, logger, processLike })).resolves.toEqual({ ok: false })
    expect(events).toContain('source-close')
    expect(events).toContain('db-terminate')
    if (events.includes('telegram-start')) expect(events).toContain('telegram-stop')
    expect(logger.error).toHaveBeenCalledWith({ code: 'source_start_failed' })
  })

  it('does not schedule a new idle timer when SIGTERM arrives during runOne', async () => {
    vi.useFakeTimers()
    try {
      const processLike = new EventEmitter()
      let resolveRunOne
      let finishTelegram
      const runtime = {
        sourceCoordinator: { async start() {}, async close() {} },
        notificationService: { runOne: () => new Promise((resolve) => { resolveRunOne = resolve }) },
        telegram: { bot: { isRunning: () => true }, async start() { await new Promise((resolve) => { finishTelegram = resolve }) },
          async stop() { finishTelegram() } },
        db: { async terminate() {} },
      }
      const running = runWorker({ runtime, enableDelivery: true, logger, processLike, shutdownMs: 100 })
      await vi.waitFor(() => expect(resolveRunOne).toBeTypeOf('function'))
      processLike.emit('SIGTERM')
      resolveRunOne(false)
      await expect(running).resolves.toEqual({ ok: true })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports source close failure and still terminates Firestore', async () => {
    const processLike = new EventEmitter()
    let finishTelegram
    let terminated = false
    const runtime = {
      sourceCoordinator: { async start() {}, async close() { throw new Error('private failure') } },
      telegram: { bot: { isRunning: () => true }, async start() { await new Promise((resolve) => { finishTelegram = resolve }) },
        async stop() { finishTelegram() } },
      db: { async terminate() { terminated = true } },
    }
    const running = runWorker({ runtime, enableDelivery: false, logger, processLike })
    await vi.waitFor(() => expect(finishTelegram).toBeTypeOf('function'))
    processLike.emit('SIGTERM')
    await expect(running).resolves.toEqual({ ok: false })
    expect(terminated).toBe(true)
    expect(logger.error).toHaveBeenCalledWith({ code: 'source_stop_failed' })
  })

  it('stops Telegram and fails closed when the lock broker exits', async () => {
    const processLike = new EventEmitter()
    processLike.exit = vi.fn()
    let finishTelegram
    let terminated = false
    const runtime = {
      sourceCoordinator: { async start() {}, async close() {} },
      telegram: { bot: { isRunning: () => true }, async start() { await new Promise((resolve) => { finishTelegram = resolve }) },
        async stop() { finishTelegram() } },
      db: { async terminate() { terminated = true } },
    }
    const lock = { lost: Promise.resolve(Object.assign(new Error('worker_lock_lost'), { safeCode: 'worker_lock_lost' })),
      assertHeld() { throw new Error('worker_lock_lost') } }
    await expect(runWorker({ runtime, enableDelivery: false, logger, processLike, lock })).resolves.toEqual({ ok: false })
    expect(terminated).toBe(true)
    expect(processLike.exit).toHaveBeenCalledWith(1)
    expect(logger.error).toHaveBeenCalledWith({ code: 'worker_lock_lost' })
  })
})
