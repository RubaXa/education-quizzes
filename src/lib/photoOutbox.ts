/** @see ../../docs/decisions/photo-transfer-recovery-2026-10-22.md
 * @see ../../docs/decisions/photo-indexeddb-recovery-2026-10-22.md
 */
import { doc, getDocFromServer, writeBatch, serverTimestamp } from 'firebase/firestore'
import type { DocumentReference, DocumentData } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from './firebase'
import { prepareEducationEvent, stagePreparedEducationEvent } from './educationEventProducer'
import { fetchWithRetry } from './networkRetry'
import { reportUiError } from './uiErrors'
import { tracePhotoStorage, traceAccess } from './browserAccessTrace'

type OutboxEntry = { id: string; file: Blob }
export type UploadState = { status: string; upload?: { href?: string; issuedAt?: unknown }; deviceUid?: string; taskId?: string }
export type PhotoTransferUiState = { phase: 'sending' } | { phase: 'failed'; message: string }
type KnownTransfer = { studentToken: string; uploadId: string; data: UploadState }
const active = new Map<string, { promise: Promise<void>; href: string; wakeRequested: boolean }>()
const knownTransfers = new Map<string, KnownTransfer>()
const dbName = 'education-photo-outbox-v1'
const indexedDbAttemptTimeoutMs = 6_000
const indexedDbAttemptCount = 2
const listeners = new Set<() => void>()
let uiStates: ReadonlyMap<string, PhotoTransferUiState> = new Map()
let lifecycleInstalled = false
let recoveryRunning = false
let recoveryOffset = 0
const attempts = new Map<string, number>()
const diagnosticWrites = new Map<string, Promise<void>>()
const lastDiagnostic = new Map<string, string>()
const lastStage = new Map<string, TransferPhase>()
const pendingDiagnostic = new Map<string, Record<string, unknown>>()
type TransferPhase = 'waiting-link' | 'reading-local' | 'missing-local' | 'checking-source' | 'sending' | 'put-complete' | 'confirming' | 'uploaded' | 'failed'

/** @see ../../docs/decisions/photo-outbox-route-recovery-2026-11-07.md */
function transferDiagnostic(studentToken: string, uploadId: string, data: UploadState, phase: TransferPhase, code = 'none', httpStatus = 0) {
  traceAccess('photo.transfer', { action: phase, code })
  if (!getAuth().currentUser?.uid || getAuth().currentUser?.uid !== data.deviceUid) return
  const id = key(studentToken, uploadId), attempt = Math.min(attempts.get(id) ?? 0, 10000)
  if (phase !== 'failed') lastStage.set(id, phase)
  const stage = lastStage.get(id) ?? phase
  const fingerprint = `${phase}:${code}:${attempt}:${httpStatus}`
  if (lastDiagnostic.get(id) === fingerprint) return
  lastDiagnostic.set(id, fingerprint)
  pendingDiagnostic.set(id, { phase, stage, code, attempt, httpStatus })
  if (diagnosticWrites.has(id)) return
  const next = (async () => {
    while (pendingDiagnostic.has(id)) {
      const value = pendingDiagnostic.get(id)!
      pendingDiagnostic.delete(id)
      try {
        const batch = writeBatch(db)
        batch.update(doc(db, 'dayUploads', studentToken, 'files', uploadId), {
          clientTransfer: { ...value, at: serverTimestamp() },
        })
        await batch.commit()
      } catch { /* Diagnosis failure never stops the original bytes. */ }
    }
  })()
  diagnosticWrites.set(id, next)
  void next.finally(() => { if (diagnosticWrites.get(id) === next) diagnosticWrites.delete(id) })
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Сервер не ответил вовремя. Снимок сохранён; передача повторится.'), { code: 'deadline-exceeded' })), 15000)
    })])
  } finally { clearTimeout(timer) }
}
function boundedRead(ref: DocumentReference<DocumentData>) { return bounded(getDocFromServer(ref)) }

/** Recover only this browser's persisted IDs, not all family uploads. */
export async function recoverLocalPhotoTransfers() {
  if (recoveryRunning || !getAuth().currentUser || navigator.onLine === false || document.visibilityState !== 'visible') return
  recoveryRunning = true
  try {
    const ids = await outboxOperation('localPhotoForTransfer', 'readonly', store => store.getAllKeys())
    if (!ids.length) { recoveryOffset = 0; return }
    const start = recoveryOffset % ids.length
    recoveryOffset = (start + 8) % ids.length
    for (let i = 0; i < Math.min(8, ids.length); i++) {
      const id = String(ids[(start + i) % ids.length]), split = id.indexOf(':')
      if (split < 1 || active.has(id)) continue
      const studentToken = id.slice(0, split), uploadId = id.slice(split + 1)
      try {
        const snapshot = await boundedRead(doc(db, 'dayUploads', studentToken, 'files', uploadId))
        if (snapshot.exists()) {
          const data = snapshot.data() as UploadState
          if (uiStates.get(id)?.phase === 'failed' && data.deviceUid === getAuth().currentUser?.uid && data.status === 'awaiting-upload') {
            void retryPhotoTransfer(studentToken, uploadId).catch(() => {})
          } else resumePhotoTransfer(studentToken, uploadId, data)
        }
      } catch { traceAccess('photo.transfer', { action: 'failed', code: 'source-read' }) }
    }
  } catch { traceAccess('photo.transfer', { action: 'failed', code: 'local-read' }) }
  finally { recoveryRunning = false }
}

/** One application-level pump, including home/reload and iOS pageshow. */
export function startPhotoOutboxRecovery() {
  const wake = () => { void recoverLocalPhotoTransfers() }
  window.addEventListener('online', wake)
  window.addEventListener('pageshow', wake)
  window.addEventListener('focus', wake)
  document.addEventListener('visibilitychange', wake)
  const timer = window.setInterval(wake, 30000)
  wake()
  return () => {
    window.clearInterval(timer)
    window.removeEventListener('online', wake)
    window.removeEventListener('pageshow', wake)
    window.removeEventListener('focus', wake)
    document.removeEventListener('visibilitychange', wake)
  }
}

function key(studentToken: string, uploadId: string) { return `${studentToken}:${uploadId}` }
function sourceKey(studentToken: string, uploadId: string) { return `${studentToken}:${uploadId}` }

export function subscribePhotoTransferUi(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function getPhotoTransferUiSnapshot() { return uiStates }
export function photoTransferUiKey(sourceId: string) { return sourceId }

function safeTransferMessage(cause: unknown) {
  if (cause instanceof Error && [
    'Откройте эту страницу на устройстве, где выбрали файл, чтобы продолжить передачу.',
    'Исходный файл остался на устройстве, где его выбрали. Откройте страницу там, чтобы повторить передачу.',
    'Не удалось прочитать сохранённый файл на этом устройстве. Оставьте страницу открытой и повторите передачу.',
    'Не удалось сохранить файл на этом устройстве. Оставьте страницу открытой, не закрывайте её и повторите попытку.',
  ].includes(cause.message)) return cause.message
  return reportUiError(cause, 'Передача файла')
}

function setUiState(id: string, state: PhotoTransferUiState | null) {
  const next = new Map(uiStates)
  if (state) next.set(id, state)
  else next.delete(id)
  uiStates = next
  for (const listener of listeners) listener()
}

function forgetTransfer(id: string) {
  knownTransfers.delete(id)
  setUiState(id, null)
}

function isCurrentAwaiting(id: string, data: UploadState) {
  const known = knownTransfers.get(id)
  return known?.data.status === 'awaiting-upload' && transferVersion(known.data) === transferVersion(data)
}

function rememberTransfer(id: string, item: KnownTransfer) {
  knownTransfers.delete(id)
  knownTransfers.set(id, item)
}

function transferVersion(data: UploadState) {
  return `${data.upload?.href ?? ''}:${timestampVersion(data.upload?.issuedAt)}`
}

function timestampVersion(value: unknown) {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    try { return String(value.toMillis()) } catch { return '' }
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    try { return String(value.toDate().getTime()) } catch { return '' }
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function installLifecycleWake() {
  if (lifecycleInstalled || typeof window === 'undefined' || typeof document === 'undefined') return
  lifecycleInstalled = true
  const wake = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    if (document.visibilityState !== 'visible') return
    for (const [id, item] of [...knownTransfers]) {
      if (knownTransfers.get(id) !== item) continue
      const running = active.get(id)
      if (running) running.wakeRequested = true
      else void retryPhotoTransfer(item.studentToken, item.uploadId).catch(() => {})
    }
  }
  window.addEventListener('online', wake)
  document.addEventListener('visibilitychange', wake)
}

function makeIndexedDbError(name: string, message: string) {
  const error = new Error(message)
  error.name = name
  return error
}

function isTransientIndexedDbError(cause: unknown) {
  if (!cause || typeof cause !== 'object') return false
  const name = 'name' in cause ? String(cause.name) : ''
  const message = 'message' in cause ? String(cause.message) : ''
  if (['QuotaExceededError', 'SecurityError', 'DataError'].includes(name)) return false
  return ['InvalidStateError', 'UnknownError', 'AbortError'].includes(name)
    || /connection to (?:indexed )?database server (?:has been )?lost|indexeddb.*connection.*lost/i.test(message)
}

function indexedDbErrorCode(cause: unknown): 'indexeddb-connection-lost' | 'invalid-state' | 'abort' | 'quota' | 'security' | 'data' | 'error' {
  const name = cause && typeof cause === 'object' && 'name' in cause ? String(cause.name) : ''
  const message = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : ''
  if (name === 'QuotaExceededError') return 'quota'
  if (name === 'SecurityError') return 'security'
  if (name === 'DataError') return 'data'
  if (/connection to (?:indexed )?database server (?:has been )?lost|indexeddb.*connection.*lost/i.test(message)) return 'indexeddb-connection-lost'
  if (name === 'InvalidStateError') return 'invalid-state'
  if (name === 'AbortError') return 'abort'
  return 'error'
}

function closeOutbox(database: IDBDatabase) {
  try { database.close() } catch { /* A lost IndexedDB connection may already be closed. */ }
}

function openOutbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    let settled = false
    const timer = globalThis.setTimeout(() => finishError(makeIndexedDbError('UnknownError', 'IndexedDB open timed out.')), indexedDbAttemptTimeoutMs)
    const finishError = (cause: unknown) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      reject(cause)
    }
    request.onupgradeneeded = () => {
      if (settled) {
        try { request.transaction?.abort() } catch { /* A late upgrade must not leave an empty schema behind. */ }
        return
      }
      if (!request.result.objectStoreNames.contains('photos')) request.result.createObjectStore('photos', { keyPath: 'id' })
    }
    request.onsuccess = () => {
      if (settled) { closeOutbox(request.result); return }
      settled = true
      globalThis.clearTimeout(timer)
      resolve(request.result)
    }
    request.onerror = () => finishError(request.error ?? makeIndexedDbError('UnknownError', 'IndexedDB open failed.'))
    request.onblocked = () => { /* A bounded timeout handles a request blocked by another tab. */ }
  })
}

function runOutboxTransaction<T>(database: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    let result: T
    let request: IDBRequest<T> | undefined
    let transaction: IDBTransaction | undefined
    const timer = globalThis.setTimeout(() => finishError(makeIndexedDbError('UnknownError', 'IndexedDB transaction timed out.')), indexedDbAttemptTimeoutMs)
    const cleanUp = (closeConnection: boolean) => {
      globalThis.clearTimeout(timer)
      database.removeEventListener('close', onClose)
      if (closeConnection) closeOutbox(database)
    }
    const finishError = (cause: unknown) => {
      if (settled) return
      settled = true
      try { transaction?.abort() } catch { /* A completed or disconnected transaction cannot be aborted. */ }
      cleanUp(false)
      reject(cause)
    }
    const onClose = () => finishError(makeIndexedDbError('UnknownError', 'IndexedDB connection was closed before the transaction completed.'))
    database.addEventListener('close', onClose, { once: true })
    try {
      transaction = database.transaction('photos', mode)
      request = run(transaction.objectStore('photos'))
    } catch (cause) {
      finishError(cause)
      return
    }
    request.onsuccess = () => { result = request!.result }
    request.onerror = () => finishError(request!.error ?? transaction!.error ?? makeIndexedDbError('UnknownError', 'IndexedDB request failed.'))
    transaction.oncomplete = () => {
      if (settled) return
      settled = true
      cleanUp(true)
      resolve(result)
    }
    transaction.onerror = () => finishError(transaction!.error ?? request?.error ?? makeIndexedDbError('UnknownError', 'IndexedDB transaction failed.'))
    transaction.onabort = () => finishError(transaction!.error ?? request?.error ?? makeIndexedDbError('AbortError', 'IndexedDB transaction was aborted.'))
  })
}

async function outboxOperation<T>(operation: 'savePhotoForTransfer' | 'localPhotoForTransfer' | 'removePhotoFromOutbox', mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  let lastError: unknown
  let lastErrorCode: ReturnType<typeof indexedDbErrorCode> | undefined
  const startedAt = Date.now()
  for (let attempt = 0; attempt < indexedDbAttemptCount; attempt += 1) {
    tracePhotoStorage(operation, 'checking', undefined, attempt + 1, Date.now() - startedAt)
    let database: IDBDatabase | undefined
    try {
      database = await openOutbox()
      const result = await runOutboxTransaction(database, mode, run)
      tracePhotoStorage(operation, 'recovered', lastErrorCode, attempt + 1, Date.now() - startedAt)
      return result
    } catch (cause) {
      lastError = cause
      lastErrorCode = indexedDbErrorCode(cause)
      if (database) closeOutbox(database)
      if (attempt + 1 >= indexedDbAttemptCount || !isTransientIndexedDbError(cause)) {
        tracePhotoStorage(operation, 'failed', lastErrorCode, attempt + 1, Date.now() - startedAt)
        throw cause
      }
      tracePhotoStorage(operation, 'retrying', lastErrorCode, attempt + 1, Date.now() - startedAt)
    }
  }
  throw lastError
}

export async function savePhotoForTransfer(studentToken: string, uploadId: string, file: Blob) {
  try {
    await outboxOperation('savePhotoForTransfer', 'readwrite', (store) => store.put({ id: key(studentToken, uploadId), file } satisfies OutboxEntry))
  } catch {
    throw new Error('Не удалось сохранить файл на этом устройстве. Оставьте страницу открытой, не закрывайте её и повторите попытку.')
  }
}
export async function localPhotoForTransfer(studentToken: string, uploadId: string): Promise<Blob | null> {
  try {
    const entry = await outboxOperation<OutboxEntry | undefined>('localPhotoForTransfer', 'readonly', (store) => store.get(key(studentToken, uploadId)))
    return entry?.file ?? null
  } catch {
    throw new Error('Не удалось прочитать сохранённый файл на этом устройстве. Оставьте страницу открытой и повторите передачу.')
  }
}
export async function removePhotoFromOutbox(studentToken: string, uploadId: string) {
  await outboxOperation('removePhotoFromOutbox', 'readwrite', (store) => store.delete(key(studentToken, uploadId)))
  forgetTransfer(sourceKey(studentToken, uploadId))
}

function validUploadHref(href: string) {
  try {
    const url = new URL(href)
    return url.protocol === 'https:' && /(^|\.)yandex\.(net|ru)$/.test(url.hostname)
  } catch { return false }
}

/** Browser transfer errors stay local and can be rendered beside the matching server upload. */
export function resumePhotoTransfer(studentToken: string, uploadId: string, data: UploadState) {
  const id = sourceKey(studentToken, uploadId)
  if (['pending', 'reviewed', 'deleted', 'uploaded', 'upload-error'].includes(data.status)) {
    forgetTransfer(id)
    if (['pending', 'reviewed', 'deleted'].includes(data.status)) void removePhotoFromOutbox(studentToken, uploadId).catch(() => {})
    return
  }
  if (data.status === 'requested') { transferDiagnostic(studentToken, uploadId, data, 'waiting-link'); return }
  if (data.status !== 'awaiting-upload' || !data.upload?.href) return
  // Diagnostic-only snapshots cannot create an immediate failure/retry loop.
  if (isCurrentAwaiting(id, data) && uiStates.get(id)?.phase === 'failed') return
  installLifecycleWake()
  rememberTransfer(id, { studentToken, uploadId, data })
  void runPhotoTransfer(id, studentToken, uploadId, data, false).catch(() => {})
}

/** Retry the existing transfer from this device's original blob; never creates a new upload request. */
export async function retryPhotoTransfer(studentToken: string, uploadId: string) {
  const id = sourceKey(studentToken, uploadId)
  const ref = doc(db, 'dayUploads', studentToken, 'files', uploadId)
  let attempted: UploadState | undefined
  try {
    const current = await boundedRead(ref)
    if (!current.exists()) { forgetTransfer(id); throw new Error('Заявка на этот файл уже отсутствует.') }
    const data = current.data() as UploadState
    if (['pending', 'reviewed', 'deleted', 'uploaded'].includes(data.status)) { forgetTransfer(id); return }
    if (data.status !== 'awaiting-upload' || !data.upload?.href) {
      throw new Error(data.status === 'requested' ? 'Заявка уже создана; ожидаем ссылку для передачи файла.'
        : 'Ссылка передачи пока недоступна. Обновите страницу чуть позже.')
    }
    installLifecycleWake()
    rememberTransfer(id, { studentToken, uploadId, data })
    attempted = data
    await runPhotoTransfer(id, studentToken, uploadId, data, true)
  } catch (cause) {
    if (cause instanceof Error && (!attempted || isCurrentAwaiting(id, attempted))) {
      setUiState(id, { phase: 'failed', message: safeTransferMessage(cause) })
    }
    throw cause
  }
}

async function runPhotoTransfer(id: string, studentToken: string, uploadId: string, data: UploadState, manual: boolean) {
  const href = data.upload?.href
  if (!href || data.status !== 'awaiting-upload') return
  const existing = active.get(id)
  if (existing) return existing.promise
  const promise = (async () => {
    const ref = doc(db, 'dayUploads', studentToken, 'files', uploadId)
    const uid = getAuth().currentUser?.uid
    if (!uid || uid !== data.deviceUid) {
      traceAccess('photo.transfer', { action: 'failed', code: !uid ? 'auth-pending' : 'device-mismatch' })
      if (manual) throw new Error('Откройте эту страницу на устройстве, где выбрали файл, чтобы продолжить передачу.')
      forgetTransfer(id)
      return
    }
    attempts.set(id, (attempts.get(id) ?? 0) + 1)
    transferDiagnostic(studentToken, uploadId, data, 'reading-local')
    const file = await localPhotoForTransfer(studentToken, uploadId)
    if (!file) {
      transferDiagnostic(studentToken, uploadId, data, 'missing-local', 'missing-local')
      if (manual) throw new Error('Исходный файл остался на устройстве, где его выбрали. Откройте страницу там, чтобы повторить передачу.')
      setUiState(id, { phase: 'failed', message: 'Сохранённый файл не найден на этом устройстве. Открой исходное устройство или выбери тот же снимок.' })
      return
    }
    transferDiagnostic(studentToken, uploadId, data, 'checking-source')
    const latestBefore = await boundedRead(ref)
    if (!latestBefore.exists()) { forgetTransfer(id); return }
    const currentBefore = latestBefore.data() as UploadState
    if (currentBefore.status !== 'awaiting-upload' || transferVersion(currentBefore) !== transferVersion(data)) {
      if (currentBefore.status === 'awaiting-upload' && currentBefore.upload?.href && currentBefore.deviceUid === uid) {
        rememberTransfer(id, { studentToken, uploadId, data: currentBefore })
      } else forgetTransfer(id)
      return
    }
    if (currentBefore.deviceUid !== uid) {
      if (manual) throw new Error('Откройте эту страницу на устройстве, где выбрали файл, чтобы продолжить передачу.')
      forgetTransfer(id)
      return
    }
    if (!validUploadHref(href)) throw new Error('Некорректная ссылка Яндекс.Диска.')
    setUiState(id, { phase: 'sending' })
    transferDiagnostic(studentToken, uploadId, data, 'sending')
    const response = await fetchWithRetry(href, { method: 'PUT', body: file, headers: { 'Content-Type': 'application/octet-stream' } }, { attempts: 4, timeoutMs: 120_000 })
    transferDiagnostic(studentToken, uploadId, data, 'put-complete', 'none', response.status)
    if (response.status === 403) throw new Error('Ссылка загрузки устарела. Файл сохранён на этом устройстве; ожидаем новую ссылку.')
    if (!response.ok && response.status !== 409) throw new Error(`Яндекс.Диск отклонил файл: HTTP ${response.status}.`)
    transferDiagnostic(studentToken, uploadId, data, 'confirming')
    const latest = await boundedRead(ref)
    if (latest.data()?.status === 'awaiting-upload' && transferVersion(latest.data() as UploadState) === transferVersion(data)) {
      const taskId = latest.data()?.taskId ?? data.taskId
      const currentUid = getAuth().currentUser?.uid
      const owner = await boundedRead(doc(db, 'dayOwners', studentToken))
      const { familyId, childId } = owner.data() ?? {}
      if (!taskId || !currentUid || currentUid !== latest.data()?.deviceUid || !owner.exists() || typeof familyId !== 'string' || typeof childId !== 'string') {
        throw new Error('Не удалось подтвердить семейную привязку передачи файла на этом устройстве.')
      }
      const operationId = `upload-transfer:${uploadId}:uploaded`
      const envelope = await prepareEducationEvent({ eventType: 'upload.bytes_uploaded', familyId, childId, source: 'firestore',
        sourceRef: { kind: 'upload', documentPath: `dayUploads/${studentToken}/files/${uploadId}`, dayToken: studentToken, recordId: uploadId, taskId },
        operationId, actor: { type: 'user', uid: currentUid } })
      const batch = writeBatch(db)
      batch.update(ref, { status: 'uploaded', eventOperationId: operationId, eventReceiptId: envelope.eventId, eventProducerVersion: 1 })
      stagePreparedEducationEvent(batch, envelope)
      try { await bounded(batch.commit()) }
      catch (cause) {
        try {
          const committed = await getDocFromServer(ref)
          if (committed.data()?.status === 'uploaded' && committed.data()?.eventOperationId === operationId
            && committed.data()?.eventReceiptId === envelope.eventId) {
            forgetTransfer(id)
            return
          }
        } catch { /* Preserve the original commit error when readback is unavailable. */ }
        throw cause
      }
      forgetTransfer(id)
      transferDiagnostic(studentToken, uploadId, data, 'uploaded')
    } else if (latest.data()?.status === 'awaiting-upload' && latest.data()?.upload?.href
      && latest.data()?.deviceUid === getAuth().currentUser?.uid) {
      rememberTransfer(id, { studentToken, uploadId, data: latest.data() as UploadState })
    } else if (latest.data()?.status) {
      forgetTransfer(id)
    }
  })()
  active.set(id, { promise, href, wakeRequested: false })
  try {
    await promise
    if (uiStates.get(id)?.phase === 'sending') setUiState(id, null)
  } catch (cause) {
    const code = cause instanceof Error && cause.message.startsWith('Ссылка загрузки устарела') ? 'url-expired'
      : cause && typeof cause === 'object' && 'code' in cause && cause.code === 'deadline-exceeded' ? 'source-timeout' : 'transfer-error'
    transferDiagnostic(studentToken, uploadId, data, 'failed', code)
    let sourceStillCurrent = true
    try {
      const latest = await boundedRead(doc(db, 'dayUploads', studentToken, 'files', uploadId))
      const latestData = latest.exists() ? latest.data() as UploadState : undefined
      if (latestData?.status === 'awaiting-upload' && latestData.upload?.href) {
        if (transferVersion(latestData) !== transferVersion(data) && latestData.deviceUid === getAuth().currentUser?.uid) {
          rememberTransfer(id, { studentToken, uploadId, data: latestData })
          sourceStillCurrent = false
        } else if (transferVersion(latestData) !== transferVersion(data) || (!manual && latestData.deviceUid !== getAuth().currentUser?.uid)) {
          sourceStillCurrent = false
          forgetTransfer(id)
        }
      } else {
        sourceStillCurrent = false
        forgetTransfer(id)
      }
    } catch { /* A failed read cannot override the local transport failure. */ }
    if (sourceStillCurrent && isCurrentAwaiting(id, data)) setUiState(id, { phase: 'failed', message: safeTransferMessage(cause) })
    throw cause
  } finally {
    const completedAttempt = active.get(id)
    if (completedAttempt?.promise === promise) active.delete(id)
    const latestKnown = knownTransfers.get(id)
    if (latestKnown && latestKnown.data.status === 'awaiting-upload' && latestKnown.data.upload?.href
      && (completedAttempt?.wakeRequested || transferVersion(latestKnown.data) !== `${href}:${timestampVersion(data.upload?.issuedAt)}`)
      && latestKnown.data.deviceUid === getAuth().currentUser?.uid) {
      void runPhotoTransfer(id, studentToken, uploadId, latestKnown.data, false).catch(() => {})
    }
  }
}
