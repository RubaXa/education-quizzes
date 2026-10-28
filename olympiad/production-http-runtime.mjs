/* @see ../docs/decisions/olympiad-family-storage-2026-10-27.md
 * @see ../docs/modules/assessments/olympiad-preparation.md */
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'
import { createOlympiadHttpHandler } from './http-handler.mjs'
import { createOlympiadRequestHandler } from './local-http-runtime.mjs'

function trustedOrigin(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password
      && url.hostname !== 'localhost' && !url.hostname.endsWith('.localhost')
      && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && !url.hostname.startsWith('[')
  } catch { return false }
}
/** Production is fail-closed: explicit project, origins, private storage and no emulators. */
export function readProductionConfig(env) {
  const projectId = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT
  const origins = (env.OLYMPIAD_ALLOWED_ORIGINS || '').split(',').map(x => x.trim())
  const port = Number(env.PORT || 8080)
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId || '') || projectId.startsWith('demo-')
    || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST || env.STORAGE_EMULATOR_HOST
    || !origins.length || !origins.every(trustedOrigin)
    || !env.OLYMPIAD_YANDEX_DISK_TOKEN || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_production_configuration')
  return { projectId, origins, port, diskToken: env.OLYMPIAD_YANDEX_DISK_TOKEN }
}

/** Logs only bounded transport outcomes. No photo, family ID, token, URL or request body. */
export function createProductionRequestHandler({ handler, origins, log = event => console.log(JSON.stringify(event)) }) {
  if (!Array.isArray(origins) || !origins.length || !origins.every(trustedOrigin)) throw new Error('invalid_production_origins')
  const transport = createOlympiadRequestHandler({ handler, origins })
  return async (req, res) => {
    const started = Date.now()
    res.once('finish', () => log({ event: 'olympiad.http', route: req.url === '/olympiad' ? 'api' : req.url === '/olympiad/photo' ? 'photo' : 'other',
      method: ['POST', 'OPTIONS'].includes(req.method) ? req.method : 'other', status: res.statusCode, durationMs: Date.now() - started }))
    return transport(req, res)
  }
}
export function createProductionOlympiadServer({ env = process.env, log } = {}) {
  const config = readProductionConfig(env)
  const app = initializeApp({ projectId: config.projectId }, `olympiad-production-${Date.now()}`)
  const storage = new YandexDiskStorage(config.diskToken)
  const handler = createOlympiadHttpHandler({ db: getFirestore(app), auth: getAuth(app), photoStorage: storage })
  return { server: createServer(createProductionRequestHandler({ handler, origins: config.origins, log })), port: config.port }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, port } = createProductionOlympiadServer()
  server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'olympiad.started', port })))
}
