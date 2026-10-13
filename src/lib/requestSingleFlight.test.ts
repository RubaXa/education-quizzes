import { describe, expect, it, vi } from 'vitest'
import { createRequestSingleFlight } from './requestSingleFlight'

describe('startup read budget', () => {
  it('shares one server read across the entry screen and bell', async () => {
    const cache = createRequestSingleFlight<string, number>(3_000)
    const serverRead = vi.fn(async () => 1)
    const oldReads = 2
    const [entry, bell] = await Promise.all([
      cache.get('device-A', serverRead, 1_000),
      cache.get('device-A', serverRead, 1_000),
    ])
    expect([entry, bell]).toEqual([1, 1])
    expect(serverRead).toHaveBeenCalledTimes(1)
    const reductionPercent = (oldReads - serverRead.mock.calls.length) / oldReads * 100
    expect(reductionPercent).toBeGreaterThanOrEqual(20)
    console.log(JSON.stringify({ scenario: 'personal-startup/two-consumers', metric: 'logical-server-reads', baseline: oldReads,
      candidate: serverRead.mock.calls.length, reductionPercent }))
  })

  it('expires, changes identity, clears on revocation and retries after failure', async () => {
    const cache = createRequestSingleFlight<string, number>(3_000)
    const serverRead = vi.fn(async () => 1)
    await cache.get('device-A', serverRead, 1_000)
    await cache.get('device-A', serverRead, 4_001)
    await cache.get('device-B', serverRead, 4_002)
    cache.clear()
    await cache.get('device-B', serverRead, 4_003)
    expect(serverRead).toHaveBeenCalledTimes(4)

    const failing = createRequestSingleFlight<string, number>(3_000)
    const load = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(2)
    await expect(failing.get('device-A', load, 1_000)).rejects.toThrow('network')
    await expect(failing.get('device-A', load, 1_001)).resolves.toBe(2)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
