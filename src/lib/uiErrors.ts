type UiError = { id: number; message: string }
type Listener = (error: UiError) => void

const listeners = new Set<Listener>()
const recent = new Map<string, number>()
let nextId = 0

export function subscribeUiErrors(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Show a short, safe explanation while keeping the original error available to the caller.
 * @see ../../docs/product/design-system.md#error-feedback */
export function reportUiError(cause: unknown, context: string): string {
  const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
  const detail = code === 'permission-denied' || code === 'auth/permission-denied' ? 'Нет доступа. Проверьте личную ссылку.'
    : code === 'unavailable' || code === 'auth/network-request-failed' || code === 'deadline-exceeded' ? 'Нет связи с Firebase. Проверьте интернет и повторите действие.'
      : code === 'unauthenticated' || code === 'auth/user-token-expired' ? 'Сеанс входа закончился. Откройте личную ссылку снова.'
        : code === 'resource-exhausted' ? 'Сервис временно занят. Повторите действие чуть позже.'
          : code ? 'Не удалось получить данные. Повторите действие.'
            : 'Действие не выполнено. Повторите попытку.'
  const message = `${context}: ${detail}`
  const now = Date.now()
  if (now - (recent.get(message) ?? 0) > 15_000) {
    recent.set(message, now)
    for (const [key, timestamp] of recent) if (now - timestamp > 60_000) recent.delete(key)
    const item = { id: ++nextId, message }
    listeners.forEach((listener) => listener(item))
  }
  return detail
}
