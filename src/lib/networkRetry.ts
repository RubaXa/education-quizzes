/** Bounded retry policy for browser requests to Yandex Disk.
 * @see ../../docs/product/storage-privacy.md#network-resilience */
const transientStatuses = new Set([408, 423, 425, 429, 500, 502, 503, 504])
const cooldowns = new Map<string, number>()

function retryAfterMs(value: string | null): number | null {
  if (!value) return null
  const seconds = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null
  if (seconds !== null) return Number.isSafeInteger(seconds) ? seconds * 1000 : null
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function delay(ms: number) { return new Promise<void>((resolve) => window.setTimeout(resolve, ms)) }
function backoffMs(attempt: number) {
  return Math.round(Math.min(30_000, 750 * 2 ** attempt) * (0.5 + Math.random() / 2))
}

export async function fetchWithRetry(
  input: string | URL, init: RequestInit = {}, { attempts = 6, timeoutMs = 60_000 } = {},
): Promise<Response> {
  const host = new URL(String(input)).host
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const cooldown = (cooldowns.get(host) ?? 0) - Date.now()
    if (cooldown > 0) await delay(cooldown)
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(input, { ...init, signal: controller.signal })
      if (!transientStatuses.has(response.status) || attempt === attempts - 1) return response
      const serverPause = retryAfterMs(response.headers.get('retry-after'))
      if (serverPause !== null && serverPause > 5 * 60_000) {
        throw new Error(`Яндекс.Диск просит подождать ${Math.ceil(serverPause / 1000)} с. Повторите позже.`)
      }
      const pause = Math.max(backoffMs(attempt), serverPause ?? 0)
      cooldowns.set(host, Math.max(cooldowns.get(host) ?? 0, Date.now() + pause))
      await delay(pause)
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith('Яндекс.Диск просит подождать')) throw cause
      if (attempt === attempts - 1) throw new Error('Связь с Яндекс.Диском не восстановилась. Попробуйте позже.', { cause })
      const pause = backoffMs(attempt)
      cooldowns.set(host, Math.max(cooldowns.get(host) ?? 0, Date.now() + pause))
      await delay(pause)
    } finally {
      window.clearTimeout(timer)
    }
  }
  throw new Error('Не удалось завершить сетевой запрос.')
}
