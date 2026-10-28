/* Education app shell. Generated at build time; no personal data is cached here.
 * @see ../docs/product/pwa.md#startup-recovery
 * @see ../docs/decisions/pwa-startup-recovery-2026-10-22.md
 */
const BASE = '/education-quizzes/'
const CACHE = 'education-shell-cc6be42b2fc26ea8'
const ASSETS = ["/education-quizzes/index.html","/education-quizzes/manifest.webmanifest","/education-quizzes/icons/education.svg","/education-quizzes/icons/education-180.png","/education-quizzes/icons/education-192.png","/education-quizzes/icons/education-512.png","/education-quizzes/assets/geist-cyrillic-ext-wght-normal-DjL33-gN.woff2","/education-quizzes/assets/geist-cyrillic-wght-normal-BEAKL7Jp.woff2","/education-quizzes/assets/geist-latin-ext-wght-normal-DC-KSUi6.woff2","/education-quizzes/assets/geist-latin-wght-normal-BgDaEnEv.woff2","/education-quizzes/assets/geist-vietnamese-wght-normal-6IgcOCM7.woff2","/education-quizzes/assets/highlight-FrxGoVib.js","/education-quizzes/assets/index-BC2Uf8WV.css","/education-quizzes/assets/index-CQ3FYDNN.js"]
const assetPaths = new Set(ASSETS.map((url) => new URL(url, self.location.origin).pathname))

// WebKit can reject CacheStorage operations with an internal error. A cache is
// an optimization, so neither a rejected nor a stuck read may block the network.
async function within(operation, milliseconds, onTimeout = () => {}) {
  let timer
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => { onTimeout(); reject(new Error('Shell read timed out')) }, milliseconds)
    })])
  } finally {
    clearTimeout(timer)
  }
}

async function readShellCache(request, options) {
  try {
    return await within(caches.open(CACHE).then((cache) => cache.match(request, options)), 1500)
  } catch {
    return undefined
  }
}

// This document works without the app bundle, fonts, CacheStorage or React.
// It cannot replace a native WebKit error page if the browser never runs the SW.
function recoveryDocument() {
  return new Response(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#4b398b"><title>Education — повторить загрузку</title>
<style>
:root{--edu-canvas:#f6f5fc;--edu-surface:#fff;--edu-ink:#30245b;--edu-muted:#70698b;--edu-primary-bg:#4b398b;--edu-control-border:#dcd3f2}
*{box-sizing:border-box}body{margin:0;background:var(--edu-canvas);color:var(--edu-ink);font:17px/1.5 system-ui,sans-serif;padding:max(24px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
main{max-width:430px;margin:12vh auto 0;padding:24px;border:1px solid var(--edu-control-border);border-radius:22px;background:var(--edu-surface)}h1{font-size:1.35rem;margin:0 0 12px}p{color:var(--edu-muted);margin:0 0 20px}
button{min-height:44px;border:0;border-radius:999px;background:var(--edu-primary-bg);color:white;padding:10px 20px;font:inherit;cursor:pointer}button:focus-visible{outline:3px solid var(--edu-ink);outline-offset:3px}
</style></head><body><main><h1>Не удалось открыть Education</h1>
<p>Проверьте подключение к интернету и повторите загрузку.</p>
<button id="retry" type="button" onclick="location.reload()">Обновить</button>
</main><script>
// Retry this failed launch once per window session, with no reload loop. If
// storage is unavailable, keep the manual button instead of guessing the count.
(() => {
  const retry = () => {
    if (!navigator.onLine || document.visibilityState !== 'visible') return;
    try {
      const key = 'education-startup-retry';
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      if (sessionStorage.getItem(key) !== '1') return;
    } catch { return; }
    location.reload();
  };
  setTimeout(retry, 1500);
  addEventListener('online', retry);
  document.addEventListener('visibilitychange', retry);
})();
</script></body></html>`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

async function navigate(request) {
  const controller = new AbortController()
  try {
    const response = await within(fetch(request, { cache: 'no-store', signal: controller.signal }), 5000, () => controller.abort())
    if (response.status < 500) return response
  } catch {
    // A suspended connection or unavailable network must not strand navigation.
  }
  return await readShellCache(`${BASE}index.html`) || recoveryDocument()
}

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
    event.respondWith(navigate(request))
    return
  }

  if (assetPaths.has(url.pathname)) {
    event.respondWith(readShellCache(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)))
  }
})
