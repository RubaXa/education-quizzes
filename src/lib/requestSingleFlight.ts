/** Keep one in-flight (and briefly settled) read for identical startup callers.
 * The short window only coalesces a render wave; it is not an authorization cache.
 * @see ../../docs/architecture/local-first-release-plan-2026-10-12.md
 */
export function createRequestSingleFlight<Key, Value>(ttlMs: number) {
  let current: { key: Key; promise: Promise<Value>; expiresAt: number; settled: boolean } | null = null
  return {
    get(key: Key, load: () => Promise<Value>, now = Date.now()): Promise<Value> {
      if (current && Object.is(current.key, key) && (!current.settled || now < current.expiresAt)) return current.promise
      const promise = load()
      const entry = { key, promise, expiresAt: now + ttlMs, settled: false }
      current = entry
      void promise.then(() => { entry.settled = true }, () => {})
      void promise.catch(() => { if (current === entry) current = null })
      return promise
    },
    clear() { current = null },
  }
}
