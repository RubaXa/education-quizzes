/** Only read requests are retried; login and token exchange are never replayed.
 * @see ../../../docs/architecture/school-diary-port-adapter.md#sync
 * @see ../../../docs/product/global-sync.md#dag
 */
export function retryAfterMs(value, now = Date.now()) {
  if (!value) return null
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}

export async function fetchMeshRead(url, options = {}, { fetcher = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return fetcher(url, { ...options, redirect: 'manual', signal: options.signal ?? AbortSignal.timeout(30000) })
  for (let attempt = 0; attempt < 3; attempt++) {
    let response
    try {
      response = await fetcher(url, { ...options, redirect: 'manual', signal: options.signal ?? AbortSignal.timeout(30000) })
    } catch (error) {
      if (options.signal?.aborted || attempt === 2) throw error
      await wait(500 * 2 ** attempt)
      continue
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) return response
    const delay = Math.max(500 * 2 ** attempt, retryAfterMs(response.headers.get('retry-after')) ?? 0)
    // A long server-imposed pause is reported to the operator; do not hold the whole run open.
    if (delay > 30000) return response
    await response.body?.cancel?.().catch(() => {})
    await wait(delay)
  }
}
