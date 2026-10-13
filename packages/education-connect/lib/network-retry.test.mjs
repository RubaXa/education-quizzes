import { describe, expect, it } from 'vitest'
import { fetchMeshRead, retryAfterMs } from './network-retry.mjs'

describe('MESH read retries', () => {
  it('uses Retry-After seconds and a bounded retry', async () => {
    const waits = []
    let calls = 0
    const response = await fetchMeshRead('https://school.mos.ru/read', {}, {
      fetcher: async () => ++calls === 1
        ? { status: 429, headers: new Headers({ 'retry-after': '2' }), body: null }
        : { status: 200, headers: new Headers(), body: null },
      wait: async (ms) => waits.push(ms),
    })
    expect(response.status).toBe(200)
    expect(calls).toBe(2)
    expect(waits).toEqual([2000])
  })
  it('does not retry a write', async () => {
    let calls = 0
    await fetchMeshRead('https://school.mos.ru/write', { method: 'POST' }, {
      fetcher: async () => { calls++; return { status: 500 } }, wait: async () => {},
    })
    expect(calls).toBe(1)
  })
  it('stops on a long Retry-After rather than ignoring it', async () => {
    let calls = 0
    const response = await fetchMeshRead('https://school.mos.ru/read', {}, {
      fetcher: async () => { calls++; return { status: 429, headers: new Headers({ 'retry-after': '120' }) } },
      wait: async () => { throw new Error('unexpected wait') },
    })
    expect(response.status).toBe(429)
    expect(calls).toBe(1)
    expect(retryAfterMs('2')).toBe(2000)
  })
})
