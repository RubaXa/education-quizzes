/* Local emulator-only runtime. Never expose this development server to a network. */
/* @see ../docs/modules/assessments/olympiad-preparation.md */
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { createOlympiadHttpHandler } from './http-handler.mjs'

const MAX_BODY = 64 * 1024
const MAX_PHOTO = 25_000_000
function localOrigin(value) {
  try { const url = new URL(value); return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.origin === value } catch { return false }
}
export function createLocalOlympiadRequestHandler({ handler, origins }) {
  if (typeof handler !== 'function' || !Array.isArray(origins) || !origins.length || !origins.every(localOrigin)) throw new Error('local_origins_required')
  return createOlympiadRequestHandler({ handler, origins })
}
/** Shared bounded HTTP transport; callers must validate origins before mounting. */
export function createOlympiadRequestHandler({ handler, origins }) {
  if (typeof handler !== 'function' || !Array.isArray(origins) || !origins.length) throw new Error('origins_required')
  const allowed = new Set(origins)
  return async (req, res) => {
    const reply = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', vary: 'Origin', ...headers })
      res.end(JSON.stringify(body))
    }
    const origin = req.headers.origin
    if (!allowed.has(origin)) return reply(403, { error: 'origin_denied' })
    const cors = { 'access-control-allow-origin': origin }
    const photoRoute = req.url === '/olympiad/photo'
    if (req.url !== '/olympiad' && !photoRoute) return reply(404, { error: 'not_found' }, cors)
    if (req.method === 'OPTIONS') {
      const requested = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean)
      const permitted = photoRoute ? ['authorization', 'content-type', 'x-olympiad-photo'] : ['authorization', 'content-type']
      if (req.headers['access-control-request-method'] !== 'POST' || requested.some(x => !permitted.includes(x))) return reply(403, { error: 'preflight_denied' }, cors)
      return reply(204, {}, { ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': permitted.join(', ') })
    }
    if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' }, cors)
    if (photoRoute ? req.headers['content-type'] !== 'application/octet-stream'
      : !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) return reply(415, { error: 'content_type_required' }, cors)
    let length = 0
    const chunks = []
    try {
      for await (const chunk of req) {
        length += chunk.length
        if (length > (photoRoute ? MAX_PHOTO : MAX_BODY)) return reply(413, { error: 'body_too_large' }, cors)
        chunks.push(chunk)
      }
      let body
      if (photoRoute) {
        const metadata = req.headers['x-olympiad-photo']
        if (typeof metadata !== 'string' || metadata.length > 4096) return reply(400, { error: 'invalid_request' }, cors)
        body = JSON.parse(metadata)
        if (!['photo-upload', 'photo-read'].includes(body?.action) || !body.request || typeof body.request !== 'object' || Array.isArray(body.request)
          || (body.action === 'photo-read' && length !== 0)) return reply(400, { error: 'invalid_request' }, cors)
      } else body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const result = await handler({ method: req.method, authorization: req.headers.authorization, body,
        ...(photoRoute ? { transport: 'binary', bytes: Buffer.concat(chunks) } : {}) })
      if (result.binary !== undefined) {
        if (!photoRoute || !Buffer.isBuffer(result.binary) || !['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(result.contentType)) return reply(500, { error: 'invalid_response' }, cors)
        res.writeHead(result.status, { 'content-type': result.contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', vary: 'Origin', ...cors })
        return res.end(result.binary)
      }
      return reply(result.status, result.body, cors)
    } catch { return reply(400, { error: 'invalid_request' }, cors) }
  }
}

/** Entry point intentionally requires demo project and both emulators. */
export function createEmulatorOlympiadServer({ projectId, origins, env = process.env, photoStorage }) {
  if (!/^demo-[a-z0-9-]+$/.test(projectId || '') || !/^127\.0\.0\.1:\d+$/.test(env.FIRESTORE_EMULATOR_HOST || '') || !/^127\.0\.0\.1:\d+$/.test(env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('local_emulators_required')
  // Admin SDK reads process.env, so reject callers supplying a divergent environment.
  if (env.FIRESTORE_EMULATOR_HOST !== process.env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST !== process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('emulator_environment_mismatch')
  const app = initializeApp({ projectId }, `olympiad-local-${Date.now()}`)
  const handler = createOlympiadHttpHandler({ db: getFirestore(app), auth: getAuth(app), photoStorage })
  return createServer(createLocalOlympiadRequestHandler({ handler, origins }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.OLYMPIAD_LOCAL_PORT || 8787)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_local_port')
  const server = createEmulatorOlympiadServer({ projectId: process.env.GCLOUD_PROJECT, origins: (process.env.OLYMPIAD_LOCAL_ORIGINS || '').split(',') })
  server.listen(port, '127.0.0.1', () => process.stdout.write(`Olympiad emulator server: http://127.0.0.1:${port}/olympiad\n`))
}
