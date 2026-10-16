/** Only date-independent calls may be reused within one child collection.
 * Every new child/run receives a new adapter and a fresh cache.
 * @see ../docs/product/global-sync.md#reconciliation */
export function reuseRunContext(adapter, onReuse = () => {}) {
  for (const method of ['getProfile', 'getMarks']) {
    const load = adapter[method].bind(adapter)
    let pending = null
    adapter[method] = () => {
      if (pending) { onReuse(method); return pending }
      pending = Promise.resolve().then(load).catch((error) => { pending = null; throw error })
      return pending
    }
  }
  return adapter
}
