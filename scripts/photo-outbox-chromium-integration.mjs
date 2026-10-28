/** Real IndexedDB transfer regression in an isolated Chromium profile.
 * @see ../docs/decisions/photo-indexeddb-recovery-2026-10-22.md
 * @see ../docs/modules/materials/storage-privacy.md#upload-queue
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'vite'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(import.meta.dirname, '..')
const outboxPath = resolve(root, 'src/lib/photoOutbox.ts')
const baselineSource = process.argv.includes('--baseline')
  ? execFileSync('git', ['show', 'HEAD:src/lib/photoOutbox.ts'], { cwd: root, encoding: 'utf8' }) : null
const playwrightCache = join(homedir(), 'Library', 'Caches', 'ms-playwright')
const cachedChromes = existsSync(playwrightCache) ? readdirSync(playwrightCache).filter((name) => /^chromium-\d+$/.test(name))
  .sort((left, right) => right.localeCompare(left, undefined, { numeric: true })).map((name) => join(playwrightCache, name,
    'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')) : []
const chrome = [process.env.CHROME_BIN, ...cachedChromes, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => path && existsSync(path))
if (!chrome) throw new Error('Для интеграционной проверки нужен Chromium или CHROME_BIN.')

const fixtureId = '\0virtual:photo-outbox-integration'
const firestoreId = '\0virtual:photo-outbox-firestore'
const authId = '\0virtual:photo-outbox-auth'
const firebaseId = '\0virtual:photo-outbox-firebase'
const eventProducerId = '\0virtual:photo-outbox-events'
const uiErrorsId = '\0virtual:photo-outbox-ui-errors'
const accessTraceId = '\0virtual:photo-outbox-access-trace'

const fixtureSource = `
import { savePhotoForTransfer, localPhotoForTransfer, resumePhotoTransfer, getPhotoTransferUiSnapshot } from '/src/lib/photoOutbox.ts'
globalThis.__photoIntegrationState = { docs: new Map(), commits: [], injectedAborts: 0, injectedModes: [] }
const state = globalThis.__photoIntegrationState
const studentToken = 'integration-day'
const uploadId = 'integration-photo-001'
const sourcePath = 'dayUploads/integration-day/files/integration-photo-001'
const sourceKey = studentToken + ':' + uploadId
const marker = 'IDB retry kept these exact photo bytes'
const bytes = new TextEncoder().encode(marker)
const source = { status: 'awaiting-upload', taskId: 'integration-task', deviceUid: 'integration-student',
  upload: { href: 'https://uploader.yandex.net/integration-photo', issuedAt: 1 } }
state.docs.set(sourcePath, source)
state.docs.set('dayOwners/integration-day', { familyId: 'integration-family', childId: 'integration-child' })
function failNextTransaction(mode) {
  const prototype = IDBDatabase.prototype
  const original = prototype.transaction
  let injected = false
  prototype.transaction = function(...args) {
    const transaction = original.apply(this, args)
    if (!injected && args[1] === mode) {
      injected = true
      state.injectedAborts += 1
      state.injectedModes.push(mode)
      queueMicrotask(() => { try { transaction.abort() } catch {} })
    }
    return transaction
  }
  return () => { prototype.transaction = original; return injected }
}
globalThis.__photoIntegration = {
  async start() {
    await savePhotoForTransfer(studentToken, uploadId, new Blob(['older retained record'], { type: 'image/jpeg' }))
    const restoreWrite = failNextTransaction('readwrite')
    await savePhotoForTransfer(studentToken, uploadId, new Blob([bytes], { type: 'image/jpeg' }))
    const writeRecovered = restoreWrite()
    const restoreRead = failNextTransaction('readonly')
    resumePhotoTransfer(studentToken, uploadId, source)
    const deadline = Date.now() + 7000
    while (state.docs.get(sourcePath)?.status !== 'uploaded' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
    const readRecovered = restoreRead()
    const stored = await localPhotoForTransfer(studentToken, uploadId)
    const storedText = stored ? await stored.text() : null
    resumePhotoTransfer(studentToken, uploadId, state.docs.get(sourcePath))
    const commits = state.commits
    const event = [...state.docs.entries()].find(([key]) => key.startsWith('educationEvents/'))?.[1]
    return {
      writeRecovered,
      readRecovered,
      storedText,
      injectedAborts: state.injectedAborts,
      injectedModes: state.injectedModes,
      sourceStatus: state.docs.get(sourcePath)?.status,
      sourceOperationId: state.docs.get(sourcePath)?.eventOperationId,
      eventType: event?.eventType,
      eventOperationId: event?.operationId,
      eventDocuments: [...state.docs.keys()].filter((key) => key.startsWith('educationEvents/')),
      commits,
      transferState: getPhotoTransferUiSnapshot().get(sourceKey) ?? null,
    }
  },
}
`

const firestoreSource = `
const getState = () => globalThis.__photoIntegrationState
export const db = {}
export const doc = (_db, ...parts) => ({ path: parts.join('/') })
export async function getDocFromServer(ref) {
  const state = getState()
  const value = state.docs.get(ref.path)
  return { exists: () => value !== undefined, data: () => value }
}
export function writeBatch() {
  const operations = []
  return {
    set(ref, value) { operations.push({ kind: 'set', path: ref.path, value }) },
    update(ref, value) { operations.push({ kind: 'update', path: ref.path, value }) },
    async commit() {
      const state = getState()
      const next = new Map(state.docs)
      for (const operation of operations) {
        const old = next.get(operation.path) ?? {}
        next.set(operation.path, operation.kind === 'set' ? operation.value : { ...old, ...operation.value })
      }
      state.docs = next
      state.commits.push(operations.map(({ kind, path }) => ({ kind, path })))
    },
  }
}
`
const authSource = `export const getAuth = () => ({ currentUser: { uid: 'integration-student' } })`
const eventProducerSource = `
import { doc } from 'firebase/firestore'
import { db } from './firebase'
export async function prepareEducationEvent(input) {
  return { ...input, eventId: 'integration-event-' + input.operationId }
}
export function stagePreparedEducationEvent(batch, envelope) {
  batch.set(doc(db, 'educationEvents', envelope.eventId), envelope)
}
`
const uiErrorsSource = `export function reportUiError() { return 'Действие не выполнено. Повторите попытку.' }`
const accessTraceSource = `export function tracePhotoStorage() {}`

const profile = mkdtempSync(join(tmpdir(), 'education-photo-outbox-chromium-'))
const site = join(profile, 'site')
const htmlPath = join(site, 'index.html')
const plugins = [{
    name: 'photo-outbox-browser-fixture',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === '/__photo-outbox-integration.ts') return fixtureId
      if (id === '/src/lib/photoOutbox.ts') return outboxPath
      if (id === 'firebase/firestore') return firestoreId
      if (id === 'firebase/auth') return authId
      if (id === './firebase' && (importer?.endsWith('/photoOutbox.ts') || importer === eventProducerId)) return firebaseId
      if (id === './educationEventProducer' && importer?.endsWith('/photoOutbox.ts')) return eventProducerId
      if (id === './uiErrors' && importer?.endsWith('/photoOutbox.ts')) return uiErrorsId
      if (id === './browserAccessTrace' && importer?.endsWith('/photoOutbox.ts')) return accessTraceId
      return null
    },
    load(id) {
      if (id === outboxPath && baselineSource) return baselineSource
      if (id === fixtureId) return fixtureSource
      if (id === firestoreId) return firestoreSource
      if (id === authId) return authSource
      if (id === firebaseId) return 'export const db = {}'
      if (id === eventProducerId) return eventProducerSource
      if (id === uiErrorsId) return uiErrorsSource
      if (id === accessTraceId) return accessTraceSource
      return null
    },
  }]
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-background-networking',
  '--disable-component-update', '--disable-default-apps', '--disable-sync', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
let socket
let port

try {
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    plugins,
    build: { outDir: site, emptyOutDir: true, rollupOptions: { input: '/__photo-outbox-integration.ts', output: { format: 'iife', name: 'PhotoOutboxIntegration', entryFileNames: 'fixture.js' } } },
  })
  writeFileSync(htmlPath, '<!doctype html><meta charset="utf-8"><script src="./fixture.js"></script>')
  const pageUrl = (await import('node:url')).pathToFileURL(htmlPath).href
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break }
    catch { await delay(100) }
  }
  if (!port) throw new Error('Chromium DevTools не запустился.')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const target = targets.find((entry) => entry.type === 'page')
  if (!target) throw new Error('Chromium не открыл вкладку проверки.')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let nextId = 0
  const pending = new Map()
  const externalRequests = []
  const putRequests = []
  const fetchRequests = []
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data)
    if (data.method === 'Network.requestWillBeSent') {
      const url = new URL(data.params.request.url)
      if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(url.origin)
    }
    if (data.method === 'Fetch.requestPaused') {
      fetchRequests.push(data.params.request.url)
      void (async () => {
        const { requestId, request, networkId } = data.params
        const url = new URL(request.url)
        if (url.protocol === 'file:') {
          await send('Fetch.continueRequest', { requestId })
          return
        }
        if (['127.0.0.1', 'localhost'].includes(url.hostname)) {
          await send('Fetch.continueRequest', { requestId })
          return
        }
        if (url.origin !== 'https://uploader.yandex.net' || !['OPTIONS', 'PUT'].includes(request.method)) {
          await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
          return
        }
        if (request.method === 'PUT') {
          let postData = request.postData
          if (networkId) {
            try { postData = (await send('Network.getRequestPostData', { requestId: networkId })).postData } catch {}
          }
          putRequests.push({ method: request.method, url: request.url, postData })
        }
        const isOptions = request.method === 'OPTIONS'
        await send('Fetch.fulfillRequest', {
          requestId,
          responseCode: isOptions ? 204 : 201,
          responseHeaders: [
            { name: 'Access-Control-Allow-Origin', value: '*' },
            { name: 'Access-Control-Allow-Methods', value: 'PUT, OPTIONS' },
            { name: 'Access-Control-Allow-Headers', value: 'content-type' },
          ],
          body: '',
        })
      })().catch((error) => { eventError = error })
      return
    }
    if (data.id === undefined) return
    const handlers = pending.get(data.id)
    if (!handlers) return
    pending.delete(data.id)
    if (data.error) handlers.reject(new Error(JSON.stringify(data.error)))
    else handlers.resolve(data.result)
  }
  let eventError
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  await send('Page.enable')
  await send('Network.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  const navigation = await send('Page.navigate', { url: pageUrl })
  if (navigation.errorText) throw new Error(`Не открылся локальный Vite fixture: ${navigation.errorText}`)
  let fixtureReady = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await send('Runtime.evaluate', { expression: 'typeof globalThis.__photoIntegration === "object"', returnByValue: true })
    if (ready.result?.value === true) { fixtureReady = true; break }
    await delay(50)
  }
  if (!fixtureReady) throw new Error('Browser fixture не стал готов за ограниченное время.')
  const expression = `(async()=>{
    if (!globalThis.__photoIntegration) throw new Error('Browser fixture module did not load')
    return await globalThis.__photoIntegration.start()
  })()`
  const evaluated = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 12_000 })
  if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text)
  const result = evaluated.result?.value
  if (!result) throw new Error('Chromium не вернул результат upload fixture.')
  if (eventError) throw eventError
  assert.equal(result.writeRecovered, true, 'aborted IndexedDB save should be retried in the real browser')
  assert.equal(result.readRecovered, true, 'aborted IndexedDB read should be retried in the real browser')
  assert.equal(result.injectedAborts, 2, 'one real readwrite and one readonly IndexedDB transaction should have been aborted')
  assert.deepEqual(result.injectedModes, ['readwrite', 'readonly'])
  assert.equal(result.storedText, 'IDB retry kept these exact photo bytes', 'the retry should read the original bytes from IndexedDB')
  assert.equal(result.sourceStatus, 'uploaded', 'the bytes-uploaded write should update the source')
  assert.equal(result.sourceOperationId, 'upload-transfer:integration-photo-001:uploaded')
  assert.equal(result.eventType, 'upload.bytes_uploaded')
  assert.equal(result.eventOperationId, 'upload-transfer:integration-photo-001:uploaded')
  assert.deepEqual(result.eventDocuments, ['educationEvents/integration-event-upload-transfer:integration-photo-001:uploaded'])
  assert.equal(result.commits.length, 1, 'source and event should be recorded in one commit')
  assert.deepEqual(result.commits[0].map((item) => item.path).sort(), [
    'dayUploads/integration-day/files/integration-photo-001',
    'educationEvents/integration-event-upload-transfer:integration-photo-001:uploaded',
  ].sort())
  assert.equal(putRequests.length, 1, 'one recovered upload should produce exactly one PUT')
  assert.equal(putRequests[0].method, 'PUT')
  assert.equal(putRequests[0].url, 'https://uploader.yandex.net/integration-photo')
  assert.equal(putRequests[0].postData, 'IDB retry kept these exact photo bytes')
  assert(fetchRequests.includes('https://uploader.yandex.net/integration-photo'))
  const unexpectedExternal = externalRequests.filter((origin) => origin !== 'https://uploader.yandex.net')
  assert.deepEqual(unexpectedExternal, [], 'the isolated browser must not contact other external origins')
  console.log('Chromium real IndexedDB save/read abort recovery → same Blob PUT → atomic bytes-uploaded source/event: passed')
} finally {
  socket?.close()
  proc.kill()
  await delay(250)
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
