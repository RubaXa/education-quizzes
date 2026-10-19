import { getAuth } from 'firebase/auth'
import { doc, getDocFromServer, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'
import type { FamilyBookUpload } from './familyLibrary'
import { currentEducationPersonId } from './personalAccess'
import { fetchWithRetry } from './networkRetry'
import { reportUiError } from './uiErrors'
import { prepareEducationEvent, stagePreparedEducationEvent } from './educationEventProducer'

/** @see ../../docs/modules/materials/family-library.md#upload */
const allowed = new Set(['application/pdf'])
const outboxName = 'education-book-outbox-v1'
const active = new Map<string, Promise<void>>()
const reportedFailures = new Set<string>()

function outbox<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(outboxName, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('files')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const database = open.result
      const transaction = database.transaction('files', mode)
      const request = run(transaction.objectStore('files'))
      let result: T
      request.onsuccess = () => { result = request.result }
      request.onerror = () => reject(request.error)
      transaction.oncomplete = () => { database.close(); resolve(result) }
      transaction.onerror = () => { database.close(); reject(transaction.error) }
    }
  })
}
function key(familyId: string, uploadId: string) { return `${familyId}:${uploadId}` }
function validUploadHref(href: string) {
  try { const url = new URL(href); return url.protocol === 'https:' && /(^|\.)yandex\.(net|ru)$/.test(url.hostname) }
  catch { return false }
}

export async function requestFamilyBookUpload(familyId: string, childId: string, subjectKey: string, file: File): Promise<string> {
  if (!allowed.has(file.type) || file.size < 1 || file.size > 100_000_000) {
    throw new Error('В первой версии загрузите полный PDF учебника размером до 100 МБ.')
  }
  const deviceUid = getAuth().currentUser?.uid
  if (!deviceUid) throw new Error('Откройте личную ссылку родителя.')
  const uploadId = crypto.randomUUID()
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join('')
  await outbox('readwrite', (store) => store.put(file, key(familyId, uploadId)))
  const ref = doc(db, 'families', familyId, 'children', childId, 'bookUploads', uploadId)
  const envelope = await prepareEducationEvent({
    eventType: 'material.upload_requested', familyId, childId, source: 'firestore',
    sourceRef: { kind: 'material', documentPath: `families/${familyId}/children/${childId}/bookUploads/${uploadId}`, recordId: uploadId },
    operationId: `material-upload:${uploadId}`, actor: { type: 'user', uid: deviceUid },
  })
  try {
    const batch = writeBatch(db)
    batch.set(ref, {
      subjectKey, originalName: file.name.slice(0, 160), contentType: file.type,
      size: file.size, sha256, deviceUid, status: 'requested', createdAt: serverTimestamp(), eventOperationId: `material-upload:${uploadId}`, eventReceiptId: envelope.eventId, eventProducerVersion: 1,
    })
    stagePreparedEducationEvent(batch, envelope)
    await batch.commit()
  } catch (cause) {
    try {
      const committed = await getDocFromServer(ref)
      const data = committed.data()
      if (committed.exists() && data?.deviceUid === deviceUid && data?.sha256 === sha256
        && data?.eventOperationId === `material-upload:${uploadId}` && data?.eventReceiptId === envelope.eventId) return uploadId
    } catch { /* Preserve the original commit error when readback is unavailable. */ }
    await outbox('readwrite', (store) => store.delete(key(familyId, uploadId)))
    throw cause
  }
  return uploadId
}

export async function setFamilyBookRequirement(familyId: string, childId: string, subjectKey: string, policy: 'required' | 'no-book') {
  const subjectId = encodeURIComponent(subjectKey)
  const ref = doc(db, 'families', familyId, 'children', childId, 'bookRequirements', subjectId)
  const current = await getDocFromServer(ref)
  if (current.data()?.policy === policy) return
  const uid = getAuth().currentUser?.uid
  if (!uid) throw new Error('Откройте личную ссылку родителя.')
  const operationId = crypto.randomUUID()
  const envelope = await prepareEducationEvent({
    eventType: 'material.requirement_changed', familyId, childId, source: 'firestore',
    sourceRef: { kind: 'material', documentPath: `families/${familyId}/children/${childId}/bookRequirements/${subjectId}`, recordId: subjectId },
    operationId, actor: { type: 'user', uid },
  })
  const batch = writeBatch(db)
  batch.set(ref, { subjectKey, policy, actorPersonId: currentEducationPersonId(), updatedAt: serverTimestamp(),
    eventOperationId: operationId, eventReceiptId: envelope.eventId, eventProducerVersion: 1 })
  stagePreparedEducationEvent(batch, envelope)
  try { await batch.commit() }
  catch (cause) {
    try {
      const committed = await getDocFromServer(ref)
      const data = committed.data()
      if (committed.exists() && data?.policy === policy && data?.eventOperationId === operationId && data?.eventReceiptId === envelope.eventId) return
    } catch { /* Preserve the original commit error when readback is unavailable. */ }
    throw cause
  }
}

/** The browser sends bytes straight to a short-lived Yandex URL; Firestore holds metadata only. */
export function resumeFamilyBookTransfer(familyId: string, childId: string, upload: FamilyBookUpload) {
  const id = key(familyId, upload.id)
  if (upload.status === 'stored' || upload.status === 'linked') {
    void outbox('readwrite', (store) => store.delete(id)).catch(() => {})
    return
  }
  if (upload.status !== 'awaiting-upload' || !upload.upload?.href || active.has(id)) return
  const job = (async () => {
    if (!validUploadHref(upload.upload!.href)) throw new Error('Некорректная ссылка Яндекс.Диска.')
    const file = await outbox<Blob | undefined>('readonly', (store) => store.get(id))
    if (!file) return
    const response = await fetchWithRetry(upload.upload!.href, { method: 'PUT', body: file, headers: { 'Content-Type': 'application/octet-stream' } }, { attempts: 4, timeoutMs: 120_000 })
    if (response.status === 403) throw new Error('Ссылка загрузки устарела. PDF сохранён на этом устройстве; ожидаем новую ссылку.')
    if (!response.ok && response.status !== 409) throw new Error(`Яндекс.Диск отклонил файл: HTTP ${response.status}.`)
    const ref = doc(db, 'families', familyId, 'children', childId, 'bookUploads', upload.id)
    const latest = await getDocFromServer(ref)
    if (latest.data()?.status === 'awaiting-upload' && latest.data()?.upload?.href === upload.upload!.href) {
      const uid = getAuth().currentUser?.uid
      if (!uid) throw new Error('Сначала откройте личную ссылку родителя.')
      const batch = writeBatch(db)
      const envelope = await prepareEducationEvent({
        eventType: 'material.bytes_uploaded', familyId, childId, source: 'firestore',
        sourceRef: { kind: 'material', documentPath: `families/${familyId}/children/${childId}/bookUploads/${upload.id}`, recordId: upload.id },
        operationId: `material-upload:${upload.id}:uploaded`, actor: { type: 'user', uid },
      })
      batch.update(ref, { status: 'uploaded', eventOperationId: `material-upload:${upload.id}:uploaded`, eventReceiptId: envelope.eventId, eventProducerVersion: 1 })
      stagePreparedEducationEvent(batch, envelope)
      await batch.commit()
    }
  })()
  active.set(id, job)
  void job.catch((cause) => {
    const failureKey = `${id}:${upload.upload!.href}`
    if (!reportedFailures.has(failureKey)) { reportedFailures.add(failureKey); reportUiError(cause, 'Передача учебника') }
  }).finally(() => { if (active.get(id) === job) active.delete(id) })
}
