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

  it('reports every actual Mesh HTTP attempt and retry without changing retry behavior', async () => {
    const observed = []
    let calls = 0
    const result = await fetchMeshRead('https://school.mos.ru/read', {}, {
      fetcher: async () => ++calls === 1
        ? { status: 503, headers: new Headers(), body: null }
        : { status: 200, headers: new Headers(), body: null },
      wait: async () => {},
      observer: {
        onAttempt: (event) => observed.push(['attempt', event]),
        onRetry: (event) => observed.push(['retry', event]),
      },
    })
    expect(result.status).toBe(200)
    expect(observed).toEqual([
      ['attempt', { attempt: 1, method: 'GET' }],
      ['retry', { attempt: 1, delayMs: 500, reason: 'http', status: 503 }],
      ['attempt', { attempt: 2, method: 'GET' }],
    ])
  })

  it('ignores telemetry callback failures', async () => {
    const response = await fetchMeshRead('https://school.mos.ru/read', {}, {
      fetcher: async () => ({ status: 200, headers: new Headers(), body: null }),
      observer: { onAttempt: () => { throw new Error('sink failed') } },
    })
    expect(response.status).toBe(200)
  })

  it('does not issue another read after shutdown aborts an in-flight retry wait', async () => {
    const controller = new AbortController()
    let calls = 0, markWaiting
    const waiting = new Promise((resolve) => { markWaiting = resolve })
    const request = fetchMeshRead('https://school.mos.ru/read', { signal: controller.signal }, {
      fetcher: async () => { calls++; throw new Error('temporary network failure') },
      wait: async () => waiting,
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(calls).toBe(1)
    controller.abort(new Error('worker_shutdown'))
    await expect(request).rejects.toThrow('worker_shutdown')
    markWaiting()
    await new Promise((resolve) => setImmediate(resolve))
    expect(calls).toBe(1)
  })

  it('rejects a request immediately when the parent shutdown signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('worker_shutdown'))
    let calls = 0
    await expect(fetchMeshRead('https://school.mos.ru/read', { signal: controller.signal }, {
      fetcher: async () => { calls++; return { status: 200 } },
    })).rejects.toThrow('worker_shutdown')
    expect(calls).toBe(0)
  })
})
