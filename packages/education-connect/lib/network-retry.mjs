/** Only read requests are retried; login and token exchange are never replayed.
 * @see ../../../docs/modules/school-diary/README.md#sync
 * @see ../../../docs/modules/synchronization/global-sync.md#dag
 */
export function retryAfterMs(value, now = Date.now()) {
  if (!value) return null
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}

function notify(observer, name, details) {
  try { observer?.[name]?.(details) } catch { /* Telemetry must never change connector behavior. */ }
}

export async function fetchMeshRead(url, options = {}, { fetcher = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), observer } = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const timeoutSignal = AbortSignal.timeout(30_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
  if (method !== 'GET' && method !== 'HEAD') {
    notify(observer, 'onAttempt', { attempt: 1, method })
    if (signal.aborted) throw signal.reason ?? new Error('mesh_request_aborted')
    return fetcher(url, { ...options, redirect: 'manual', signal })
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal.aborted) throw signal.reason ?? new Error('mesh_request_aborted')
    let response
    notify(observer, 'onAttempt', { attempt: attempt + 1, method })
    try {
      response = await fetcher(url, { ...options, redirect: 'manual', signal })
    } catch (error) {
      if (options.signal?.aborted || attempt === 2) throw error
      const delayMs = 500 * 2 ** attempt
      notify(observer, 'onRetry', { attempt: attempt + 1, delayMs, reason: 'network' })
      await waitForRetry(wait, delayMs, signal)
      continue
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) return response
    const delay = Math.max(500 * 2 ** attempt, retryAfterMs(response.headers.get('retry-after')) ?? 0)
    // A long server-imposed pause is reported to the operator; do not hold the whole run open.
    if (delay > 30000) return response
    await response.body?.cancel?.().catch(() => {})
    notify(observer, 'onRetry', { attempt: attempt + 1, delayMs: delay, reason: 'http', status: response.status })
    await waitForRetry(wait, delay, signal)
  }
}

function waitForRetry(wait, delayMs, signal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('mesh_request_aborted'))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onAbort = () => finish(signal.reason ?? new Error('mesh_request_aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve().then(() => wait(delayMs)).then(() => finish(), finish)
  })
}
