/** Shared server Firestore and local/ambient ADC factory.
 * @see ../../docs/shared/server-runtime.md#границы-и-порты
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { Firestore } from '@google-cloud/firestore'

const require = createRequire(import.meta.url)

/** Resolve and validate local ADC; null means the runtime's ambient ADC is used. */
export function prepareLocalApplicationCredentials({ cwd = process.cwd(), env = process.env, fs = defaultFs,
  loadFirebaseTools = () => require('firebase-tools/lib/api') } = {}) {
  const configured = env.GOOGLE_APPLICATION_CREDENTIALS
  if (configured) {
    const file = resolve(cwd, configured)
    validateCredentialFile(file, fs)
    return file
  }

  const adcFile = resolve(cwd, '.local/adc.json')
  if (fs.existsSync(adcFile)) {
    validateCredentialFile(adcFile, fs)
    env.GOOGLE_APPLICATION_CREDENTIALS = adcFile
    return adcFile
  }

  const loginFile = resolve(cwd, '.local/config/configstore/firebase-tools.json')
  if (!fs.existsSync(loginFile)) return null // Google Cloud ADC can be supplied by the host.
  let login
  try { login = JSON.parse(fs.readFileSync(loginFile, 'utf8')) }
  catch { throw new Error('Локальный вход Firebase CLI не удалось проверить.') }
  if (typeof login?.tokens?.refresh_token !== 'string' || !login.tokens.refresh_token) {
    throw new Error('Локальный вход Firebase CLI устарел.')
  }
  let firebaseTools
  try { firebaseTools = loadFirebaseTools() }
  catch { throw new Error('Локальный вход Firebase CLI не удалось проверить.') }
  const clientId = firebaseTools.clientId?.(), clientSecret = firebaseTools.clientSecret?.()
  if (typeof clientId !== 'string' || !clientId || typeof clientSecret !== 'string' || !clientSecret) {
    throw new Error('Локальный вход Firebase CLI не удалось проверить.')
  }
  fs.mkdirSync(resolve(cwd, '.local'), { recursive: true, mode: 0o700 })
  fs.writeFileSync(adcFile, JSON.stringify({ type: 'authorized_user', client_id: clientId,
    client_secret: clientSecret, refresh_token: login.tokens.refresh_token }), { mode: 0o600 })
  validateCredentialFile(adcFile, fs)
  env.GOOGLE_APPLICATION_CREDENTIALS = adcFile
  return adcFile
}

/** Production Google Cloud Firestore client with an explicit project binding. */
export function createEducationFirestore({ projectId, cwd = process.cwd(), env = process.env, fs = defaultFs,
  prepareCredentials = prepareLocalApplicationCredentials, FirestoreClass = Firestore, telemetry = null,
  firestoreOptions = {} } = {}) {
  if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('firestore_project_required')
  return span(telemetry, 'firestore.client.initialize', () => {
    const keyFilename = prepareCredentials({ cwd, env, fs })
    const client = new FirestoreClass({ ...firestoreOptions, projectId, ...(keyFilename ? { keyFilename } : {}) })
    return telemetry ? instrumentFirestoreClient(client, telemetry) : client
  }, { source: 'firestore' })
}

/** Instrument SDK I/O while preserving bound methods and immutable query chains. */
export function instrumentFirestoreClient(client, telemetry) {
  if (!client || typeof client !== 'object' || !telemetry?.span) return client
  const proxies = new WeakMap()
  const queryChainMethods = new Set(['collection', 'doc', 'where', 'orderBy', 'startAfter', 'startAt', 'endAt', 'endBefore', 'limit', 'offset', 'select'])
  const writeMethods = new Set(['set', 'create', 'update', 'delete', 'commit'])
  const wrap = (target, kind) => {
    if (!target || typeof target !== 'object') return target
    const prior = proxies.get(target)
    if (prior) return prior
    const proxy = new Proxy(target, { get(object, property) {
      const value = Reflect.get(object, property, object)
      if (typeof value !== 'function') return value
      if (queryChainMethods.has(property)) return (...args) => wrap(Reflect.apply(value, object, args), nextKind(property, kind))
      if (property === 'runTransaction') return (...args) => {
        const callback = args[0]
        if (typeof callback === 'function') args[0] = (transaction) => callback(wrap(transaction, 'transaction'))
        telemetry.count('firestore.transactions')
        return telemetry.span('firestore.transaction', () => Reflect.apply(value, object, args), { source: 'firestore' })
      }
      if (property === 'batch') return (...args) => wrap(Reflect.apply(value, object, args), 'batch')
      if (property === 'onSnapshot') return (...args) => {
        const callbackIndex = args.findIndex((arg) => typeof arg === 'function')
        if (callbackIndex >= 0) {
          const callback = args[callbackIndex]
          args[callbackIndex] = (snapshot, ...rest) => {
            const size = snapshotSize(snapshot, kind)
            telemetry.count('firestore.listener.snapshots')
            telemetry.count('firestore.documents.returned', size)
            return callback(snapshot, ...rest)
          }
        }
        telemetry.count('firestore.listeners.opened')
        return telemetry.span('firestore.listener.attach', () => Reflect.apply(value, object, args), { source: 'firestore' })
      }
      if (property === 'get' || property === 'getAll') return (...args) => {
        const result = telemetry.span(kind === 'document' ? 'firestore.document.read' : 'firestore.query.read',
          () => Reflect.apply(value, object, args), { source: 'firestore' })
        return observeRead(result, kind, telemetry)
      }
      if (writeMethods.has(property)) return (...args) => {
        if (kind === 'batch' && property !== 'commit') {
          telemetry.count('firestore.batch.writes')
          return wrap(Reflect.apply(value, object, args), 'batch')
        }
        if (kind === 'transaction') {
          telemetry.count('firestore.transaction.writes')
          return Reflect.apply(value, object, args)
        }
        telemetry.count(`firestore.${kind}.writes`)
        return telemetry.span(kind === 'batch' ? 'firestore.batch.commit' : 'firestore.write',
          () => Reflect.apply(value, object, args), { source: 'firestore' })
      }
      return value.bind(object)
    } })
    proxies.set(target, proxy)
    return proxy
  }
  return wrap(client, 'client')
}

function nextKind(method, current) {
  if (method === 'doc') return 'document'
  if (method === 'collection') return 'query'
  return current === 'document' ? 'document' : 'query'
}

function observeRead(result, kind, telemetry) {
  const observe = (value) => {
    const size = kind === 'document' && value?.exists === false ? 0 : snapshotSize(value, kind)
    telemetry.count('firestore.documents.returned', size)
    return value
  }
  return result && typeof result.then === 'function' ? result.then(observe) : observe(result)
}

function snapshotSize(value, kind) {
  if (Array.isArray(value)) return value.length
  if (Array.isArray(value?.docs)) return value.docs.length
  if (kind === 'document' || kind === 'transaction') return value?.exists === false ? 0 : 1
  return 0
}

function validateCredentialFile(file, fs) {
  let credentials
  try {
    if (!fs.existsSync(file)) throw new Error('missing')
    credentials = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch { throw new Error('Файл полномочий Firebase отсутствует или повреждён.') }
  const validServiceAccount = credentials?.type === 'service_account'
    && typeof credentials.project_id === 'string' && typeof credentials.client_email === 'string'
    && typeof credentials.private_key === 'string'
  const validAuthorizedUser = credentials?.type === 'authorized_user'
    && typeof credentials.client_id === 'string' && typeof credentials.client_secret === 'string'
    && typeof credentials.refresh_token === 'string'
  if (!validServiceAccount && !validAuthorizedUser) throw new Error('Файл полномочий Firebase имеет неподдерживаемый формат.')
}

function span(telemetry, operation, work, attributes) {
  return telemetry?.span ? telemetry.span(operation, work, attributes) : work()
}

const defaultFs = { existsSync, mkdirSync, readFileSync, writeFileSync }
