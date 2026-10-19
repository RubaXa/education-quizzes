import { afterEach, describe, expect, it, vi } from 'vitest'
import { withOperationDeadline } from './operation-deadline.mjs'

afterEach(() => vi.useRealTimers())

describe('active operation deadlines', () => {
  it('fires once for a pending operation and leaves settlement to the process boundary', async () => {
    vi.useFakeTimers()
    let complete
    const timedOut = vi.fn()
    const operation = withOperationDeadline(() => new Promise((resolve) => { complete = resolve }), {
      timeoutMs: 50, operation: 'source_reconcile', onTimeout: timedOut,
    })
    const pending = operation()
    await vi.advanceTimersByTimeAsync(50)
    expect(timedOut).toHaveBeenCalledExactlyOnceWith('source_reconcile')
    complete('late completion')
    await expect(pending).resolves.toBe('late completion')
    expect(timedOut).toHaveBeenCalledTimes(1)
  })

  it('clears its timer after success and rejects invalid operation names', async () => {
    vi.useFakeTimers()
    const timedOut = vi.fn()
    const operation = withOperationDeadline(async () => 'done', {
      timeoutMs: 50, operation: 'delivery_run_one', onTimeout: timedOut,
    })
    await expect(operation()).resolves.toBe('done')
    await vi.advanceTimersByTimeAsync(100)
    expect(timedOut).not.toHaveBeenCalled()
    expect(() => withOperationDeadline(() => {}, { timeoutMs: 1, operation: 'private_data', onTimeout: timedOut }))
      .toThrow('operation_name_invalid')
  })

  it('accepts the education event consumer operation used by the worker', async () => {
    const operation = withOperationDeadline(async () => 'dispatched', {
      timeoutMs: 50, operation: 'education_event_dispatch', onTimeout: vi.fn(),
    })
    await expect(operation()).resolves.toBe('dispatched')
  })
})
