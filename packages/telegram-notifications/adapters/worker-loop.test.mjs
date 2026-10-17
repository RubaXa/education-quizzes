import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { runWorker } from './worker-loop.mjs'

const logger = { info() {}, error: vi.fn() }

describe('worker source lifecycle', () => {
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
})
