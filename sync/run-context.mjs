/** Only date-independent calls may be reused within one child collection.
 * Every new child/run receives a new adapter and a fresh cache.
 * @see ../docs/modules/synchronization/global-sync.md#reconciliation */
export function reuseRunContext(adapter, onReuse = () => {}, telemetry = null) {
  for (const method of ['getProfile', 'getMarks']) {
    const load = adapter[method].bind(adapter)
    let pending = null
    adapter[method] = () => {
      if (pending) { onReuse(method); telemetry?.count?.('sync.cache.hits', 1, { stage: method }); return pending }
      telemetry?.count?.('sync.cache.misses', 1, { stage: method })
      pending = Promise.resolve().then(load).catch((error) => { pending = null; throw error })
      return pending
    }
  }
  return adapter
}
