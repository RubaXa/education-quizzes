/** @see ../../../docs/services/telegram-bot/operations.md#runtime-boundary */

const OPERATIONS = new Set(['startup_verify', 'source_start', 'source_reconcile', 'source_pipeline', 'delivery_run_one', 'education_sync_dispatch'])

/** Guard one active operation. A timeout requests process termination because an
 * underlying SDK promise may still complete and write after its caller gives up.
 */
export function withOperationDeadline(work, { timeoutMs, operation, onTimeout }) {
  if (typeof work !== 'function') throw new TypeError('operation_work_required')
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new TypeError('operation_timeout_invalid')
  if (!OPERATIONS.has(operation)) throw new TypeError('operation_name_invalid')
  if (typeof onTimeout !== 'function') throw new TypeError('operation_timeout_handler_required')
  const wrapped = function operationDeadline(...args) {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      onTimeout(operation)
    }, timeoutMs)
    timer.unref?.()
    let result
    try { result = work.apply(this, args) }
    catch (error) { settled = true; clearTimeout(timer); throw error }
    return Promise.resolve(result).finally(() => { settled = true; clearTimeout(timer) })
  }
  Object.defineProperty(wrapped, '__operationDeadline', { value: true })
  return wrapped
}
