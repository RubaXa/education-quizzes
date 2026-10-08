let applyingEducationUpdate = false

/** @see ../../docs/product/pwa.md#updates */
export function registerEducationApp(onUpdateReady: () => void) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return () => {}
  const base = import.meta.env.BASE_URL
  let registration: ServiceWorkerRegistration | undefined
  let active = true

  const ready = () => { if (active && navigator.serviceWorker.controller) onUpdateReady() }
  const updateFound = () => {
    const worker = registration?.installing
    worker?.addEventListener('statechange', () => { if (worker.state === 'installed') ready() })
  }
  const check = () => { if (document.visibilityState === 'visible' && navigator.onLine) void registration?.update().catch(() => {}) }
  const controllerChanged = () => { if (applyingEducationUpdate) location.reload() }
  navigator.serviceWorker.addEventListener('controllerchange', controllerChanged)
  document.addEventListener('visibilitychange', check)
  window.addEventListener('online', check)

  void navigator.serviceWorker.register(`${base}sw.js`, { scope: base, updateViaCache: 'none' }).then((next) => {
    if (!active) return
    registration = next
    registration.addEventListener('updatefound', updateFound)
    if (registration.waiting) ready()
    check()
  }).catch(() => {})

  const timer = window.setInterval(check, 30 * 60 * 1000)
  return () => {
    active = false
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', check)
    window.removeEventListener('online', check)
    navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged)
    registration?.removeEventListener('updatefound', updateFound)
  }
}

/** @see ../../docs/product/pwa.md#updates */
export async function activateEducationUpdate() {
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  if (!registration?.waiting) throw new Error('Новая версия пока не загружена. Откройте страницу позже.')
  applyingEducationUpdate = true
  registration.waiting.postMessage({ type: 'SKIP_WAITING' })
}
