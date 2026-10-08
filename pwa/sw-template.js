/* Education app shell. Generated at build time; no personal data is cached here. */
const BASE = '/education-quizzes/'
const CACHE = '__CACHE_NAME__'
const ASSETS = __PRECACHE_URLS__
const assetPaths = new Set(ASSETS.map((url) => new URL(url, self.location.origin).pathname))

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.startsWith('education-shell-') && name !== CACHE).map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(async () => {
      const cached = await caches.match(`${BASE}index.html`)
      return cached || Response.error()
    }))
    return
  }

  if (assetPaths.has(url.pathname)) {
    event.respondWith(caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)))
  }
})
