/** Fault injection for the installed app's navigation and asset responses.
 * @see ../docs/product/pwa.md#startup-recovery
 */
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8')
  .replace('__CACHE_NAME__', 'education-shell-current')
  .replace('__PRECACHE_URLS__', JSON.stringify(['/education-quizzes/index.html', '/education-quizzes/assets/app.js']))
const base = 'https://education.example/education-quizzes/'
const unavailable = () => Promise.reject(new TypeError('Internal error'))
const hanging = () => new Promise(() => {})

function worker({ cacheMatch = async () => undefined, open, network = async () => new Response('network') } = {}) {
  const listeners = new Map()
  const cache = { match: vi.fn(cacheMatch), addAll: vi.fn() }
  const caches = { open: vi.fn(open ?? (async () => cache)), match: vi.fn(cacheMatch), keys: async () => [] }
  const fetch = vi.fn(network)
  runInNewContext(source, {
    self: { location: { origin: new URL(base).origin }, addEventListener: (type, handler) => listeners.set(type, handler) },
    caches, fetch, URL, Response, AbortController, setTimeout, clearTimeout,
  })
  const request = (path = '', mode = 'navigate', method = 'GET') => {
    let response
    listeners.get('fetch')({ request: { method, mode, url: new URL(path, base).href }, respondWith: (value) => { response = value } })
    return response
  }
  return { request, cache, caches, fetch }
}

afterEach(() => vi.useRealTimers())

describe('installed Education startup', () => {
  it('uses fresh HTML when the network succeeds', async () => {
    const app = worker()
    expect(await (await app.request()).text()).toBe('network')
  })

  it('falls through to the network when WebKit rejects an asset cache read', async () => {
    const app = worker({ cacheMatch: unavailable })
    expect(await (await app.request('assets/app.js', 'cors')).text()).toBe('network')
  })

  it('falls through to the network when the cache cannot be opened', async () => {
    const app = worker({ open: unavailable })
    expect(await (await app.request('assets/app.js', 'cors')).text()).toBe('network')
  })

  it('bounds a hung cache read instead of leaving the script pending forever', async () => {
    vi.useFakeTimers()
    const app = worker({ cacheMatch: hanging })
    const response = app.request('assets/app.js', 'cors')
    await vi.advanceTimersByTimeAsync(2000)
    expect(await (await response).text()).toBe('network')
  })

  it('opens the installed shell offline from this worker version only', async () => {
    const app = worker({ network: unavailable, cacheMatch: async () => new Response('installed shell') })
    expect(await (await app.request()).text()).toBe('installed shell')
    expect(app.caches.open).toHaveBeenCalledWith('education-shell-current')
    expect(app.caches.match).not.toHaveBeenCalled()
  })

  it('uses the installed shell during a temporary HTTP server error', async () => {
    const app = worker({ network: async () => new Response('down', { status: 503 }), cacheMatch: async () => new Response('installed shell') })
    expect(await (await app.request()).text()).toBe('installed shell')
  })

  it('bounds a hung navigation and aborts the abandoned request', async () => {
    vi.useFakeTimers()
    const app = worker({ network: hanging, cacheMatch: async () => new Response('installed shell') })
    const response = app.request()
    await vi.advanceTimersByTimeAsync(6000)
    expect(await (await response).text()).toBe('installed shell')
    expect(app.fetch.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it('returns a usable recovery document when both network and cache fail', async () => {
    const app = worker({ network: unavailable, cacheMatch: unavailable })
    const response = await app.request()
    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const html = await response.text()
    expect(html).toContain('Обновить')
    expect(html).not.toContain('Internal error')
    expect(html).not.toContain('education.example')
  })

  it('leaves authorization failures intact instead of hiding them with the shell', async () => {
    const app = worker({ network: async () => new Response('forbidden', { status: 403 }) })
    expect((await app.request()).status).toBe(403)
  })

  it('does not mix asset bytes with a different installed release', async () => {
    const app = worker({ cacheMatch: async () => new Response('cached script') })
    expect(await (await app.request('assets/app.js?v=1', 'cors')).text()).toBe('cached script')
    expect(app.caches.open).toHaveBeenCalledWith('education-shell-current')
    expect(app.cache.match.mock.calls[0][1]).toEqual({ ignoreSearch: true })
    expect(app.fetch).not.toHaveBeenCalled()
  })

  it('also escapes a hung cache when navigation has already failed', async () => {
    vi.useFakeTimers()
    const app = worker({ network: unavailable, open: hanging })
    const response = app.request()
    await vi.advanceTimersByTimeAsync(2000)
    expect((await response).status).toBe(503)
  })

  it('does not intercept personal APIs, third party media or writes', () => {
    const app = worker()
    expect(app.request('https://firestore.googleapis.com/v1/projects/example', 'cors')).toBeUndefined()
    expect(app.request('private-photo.jpg', 'cors')).toBeUndefined()
    expect(app.request('', 'cors', 'POST')).toBeUndefined()
  })
})

describe('bundle independent recovery document', () => {
  async function recoveryPage({ online = true, visible = true, denied = false, values = new Map() } = {}) {
    const html = await (await worker({ network: unavailable, open: unavailable }).request()).text()
    const script = html.match(/<script>([\s\S]+?)<\/script>/)[1]
    const listeners = new Map()
    const location = { reload: vi.fn() }
    const navigator = { onLine: online }
    const document = { visibilityState: visible ? 'visible' : 'hidden', addEventListener: (type, handler) => listeners.set(type, handler) }
    const storage = {
      getItem: (key) => { if (denied) throw new Error('Storage blocked'); return values.get(key) ?? null },
      setItem: (key, value) => { if (denied) throw new Error('Storage blocked'); values.set(key, value) },
    }
    runInNewContext(script, { navigator, document, location, sessionStorage: storage, setTimeout, addEventListener: (type, handler) => listeners.set(type, handler) })
    return { location, navigator, document, listeners, values, html }
  }

  it('retries only once across failed reloads and repeated lifecycle events', async () => {
    vi.useFakeTimers()
    const first = await recoveryPage()
    await vi.advanceTimersByTimeAsync(1600)
    first.listeners.get('online')()
    first.listeners.get('visibilitychange')()
    expect(first.location.reload).toHaveBeenCalledTimes(1)
    const second = await recoveryPage({ values: first.values })
    await vi.advanceTimersByTimeAsync(1600)
    expect(second.location.reload).not.toHaveBeenCalled()
  })

  it('waits for the network before making its single automatic retry', async () => {
    vi.useFakeTimers()
    const page = await recoveryPage({ online: false })
    await vi.advanceTimersByTimeAsync(1600)
    expect(page.location.reload).not.toHaveBeenCalled()
    page.navigator.onLine = true
    page.listeners.get('online')()
    expect(page.location.reload).toHaveBeenCalledTimes(1)
  })

  it('waits until the app is visible', async () => {
    vi.useFakeTimers()
    const page = await recoveryPage({ visible: false })
    await vi.advanceTimersByTimeAsync(1600)
    expect(page.location.reload).not.toHaveBeenCalled()
    page.document.visibilityState = 'visible'
    page.listeners.get('visibilitychange')()
    expect(page.location.reload).toHaveBeenCalledTimes(1)
  })

  it('keeps manual refresh usable when storage is blocked', async () => {
    vi.useFakeTimers()
    const page = await recoveryPage({ denied: true })
    await vi.advanceTimersByTimeAsync(1600)
    page.listeners.get('online')()
    expect(page.location.reload).not.toHaveBeenCalled()
    expect(page.html).toContain('onclick="location.reload()"')
    expect(page.html).not.toMatch(/localStorage|indexedDB|caches\.delete/)
  })
})
