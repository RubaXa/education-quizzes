/** @see ../../docs/decisions/photo-transfer-recovery-2026-10-22.md */
import { doc, getDocFromServer, writeBatch } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from './firebase'
import { prepareEducationEvent, stagePreparedEducationEvent } from './educationEventProducer'
import { fetchWithRetry } from './networkRetry'
import { reportUiError } from './uiErrors'

type OutboxEntry = { id: string; file: Blob }
export type UploadState = { status: string; upload?: { href?: string; issuedAt?: unknown }; deviceUid?: string; taskId?: string }
export type PhotoTransferUiState = { phase: 'sending' } | { phase: 'failed'; message: string }
type KnownTransfer = { studentToken: string; uploadId: string; data: UploadState }
const active = new Map<string, { promise: Promise<void>; href: string; wakeRequested: boolean }>()
const knownTransfers = new Map<string, KnownTransfer>()
const dbName = 'education-photo-outbox-v1'
const listeners = new Set<() => void>()
let uiStates: ReadonlyMap<string, PhotoTransferUiState> = new Map()
let lifecycleInstalled = false

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
    'Откройте эту страницу на устройстве, где выбрали фото, чтобы продолжить передачу.',
    'Исходное фото осталось на устройстве, где его выбрали. Откройте страницу там, чтобы повторить передачу.',
  ].includes(cause.message)) return cause.message
  return reportUiError(cause, 'Передача фото')
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
      else resumePhotoTransfer(item.studentToken, item.uploadId, item.data)
    }
  }
  window.addEventListener('online', wake)
  document.addEventListener('visibilitychange', wake)
}

function openOutbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function outboxOperation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openOutbox()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('photos', mode)
    const request = run(transaction.objectStore('photos'))
    let result: T
    request.onsuccess = () => { result = request.result }
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => { database.close(); resolve(result) }
    transaction.onerror = () => { database.close(); reject(transaction.error) }
  })
}

export async function savePhotoForTransfer(studentToken: string, uploadId: string, file: Blob) {
  await outboxOperation('readwrite', (store) => store.put({ id: key(studentToken, uploadId), file } satisfies OutboxEntry))
}
export async function localPhotoForTransfer(studentToken: string, uploadId: string): Promise<Blob | null> {
  const entry = await outboxOperation<OutboxEntry | undefined>('readonly', (store) => store.get(key(studentToken, uploadId)))
  return entry?.file ?? null
}
export async function removePhotoFromOutbox(studentToken: string, uploadId: string) {
  await outboxOperation('readwrite', (store) => store.delete(key(studentToken, uploadId)))
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
  if (data.status !== 'awaiting-upload' || !data.upload?.href) return
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
    const current = await getDocFromServer(ref)
    if (!current.exists()) { forgetTransfer(id); throw new Error('Заявка на это фото уже отсутствует.') }
    const data = current.data() as UploadState
    if (['pending', 'reviewed', 'deleted', 'uploaded'].includes(data.status)) { forgetTransfer(id); return }
    if (data.status !== 'awaiting-upload' || !data.upload?.href) {
      throw new Error(data.status === 'requested' ? 'Заявка уже создана; ожидаем ссылку для передачи фото.'
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
      if (manual) throw new Error('Откройте эту страницу на устройстве, где выбрали фото, чтобы продолжить передачу.')
      forgetTransfer(id)
      return
    }
    const file = await localPhotoForTransfer(studentToken, uploadId)
    if (!file) {
      if (manual) throw new Error('Исходное фото осталось на устройстве, где его выбрали. Откройте страницу там, чтобы повторить передачу.')
      forgetTransfer(id)
      return
    }
    const latestBefore = await getDocFromServer(ref)
    if (!latestBefore.exists()) { forgetTransfer(id); return }
    const currentBefore = latestBefore.data() as UploadState
    if (currentBefore.status !== 'awaiting-upload' || transferVersion(currentBefore) !== transferVersion(data)) {
      if (currentBefore.status === 'awaiting-upload' && currentBefore.upload?.href && currentBefore.deviceUid === uid) {
        rememberTransfer(id, { studentToken, uploadId, data: currentBefore })
      } else forgetTransfer(id)
      return
    }
    if (currentBefore.deviceUid !== uid) {
      if (manual) throw new Error('Откройте эту страницу на устройстве, где выбрали фото, чтобы продолжить передачу.')
      forgetTransfer(id)
      return
    }
    if (!validUploadHref(href)) throw new Error('Некорректная ссылка Яндекс.Диска.')
    setUiState(id, { phase: 'sending' })
    const response = await fetchWithRetry(href, { method: 'PUT', body: file, headers: { 'Content-Type': 'application/octet-stream' } }, { attempts: 4, timeoutMs: 120_000 })
    if (response.status === 403) throw new Error('Ссылка загрузки устарела. Фото сохранено на этом устройстве; ожидаем новую ссылку.')
    if (!response.ok && response.status !== 409) throw new Error(`Яндекс.Диск отклонил фото: HTTP ${response.status}.`)
    const latest = await getDocFromServer(ref)
    if (latest.data()?.status === 'awaiting-upload' && transferVersion(latest.data() as UploadState) === transferVersion(data)) {
      const taskId = latest.data()?.taskId ?? data.taskId
      const currentUid = getAuth().currentUser?.uid
      const owner = await getDocFromServer(doc(db, 'dayOwners', studentToken))
      const { familyId, childId } = owner.data() ?? {}
      if (!taskId || !currentUid || currentUid !== latest.data()?.deviceUid || !owner.exists() || typeof familyId !== 'string' || typeof childId !== 'string') {
        throw new Error('Не удалось подтвердить семейную привязку передачи фото на этом устройстве.')
      }
      const operationId = `upload-transfer:${uploadId}:uploaded`
      const envelope = await prepareEducationEvent({ eventType: 'upload.bytes_uploaded', familyId, childId, source: 'firestore',
        sourceRef: { kind: 'upload', documentPath: `dayUploads/${studentToken}/files/${uploadId}`, dayToken: studentToken, recordId: uploadId, taskId },
        operationId, actor: { type: 'user', uid: currentUid } })
      const batch = writeBatch(db)
      batch.update(ref, { status: 'uploaded', eventOperationId: operationId, eventReceiptId: envelope.eventId, eventProducerVersion: 1 })
      stagePreparedEducationEvent(batch, envelope)
      try { await batch.commit() }
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
    let sourceStillCurrent = true
    try {
      const latest = await getDocFromServer(doc(db, 'dayUploads', studentToken, 'files', uploadId))
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
