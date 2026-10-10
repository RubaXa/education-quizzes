import { doc, getDocFromServer, updateDoc } from 'firebase/firestore'
import { db } from './firebase'

type OutboxEntry = { id: string; file: Blob }
type UploadState = { status: string; upload?: { href: string }; deviceUid?: string }
const active = new Map<string, Promise<void>>()
const dbName = 'education-photo-outbox-v1'

function key(studentToken: string, uploadId: string) { return `${studentToken}:${uploadId}` }

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
}

function validUploadHref(href: string) {
  try {
    const url = new URL(href)
    return url.protocol === 'https:' && /(^|\.)yandex\.(net|ru)$/.test(url.hostname)
  } catch { return false }
}

/** The browser sends bytes straight to Yandex; Firestore carries only the capability and state. */
export function resumePhotoTransfer(studentToken: string, uploadId: string, data: UploadState) {
  const id = key(studentToken, uploadId)
  if (data.status === 'pending' || data.status === 'reviewed' || data.status === 'deleted') {
    void removePhotoFromOutbox(studentToken, uploadId).catch(() => {})
    return
  }
  if (data.status !== 'awaiting-upload' || !data.upload?.href || active.has(id)) return
  const job = (async () => {
    const ref = doc(db, 'dayUploads', studentToken, 'files', uploadId)
    const file = await localPhotoForTransfer(studentToken, uploadId)
    if (!file) return // Another device cannot reconstruct the original file.
    if (!validUploadHref(data.upload!.href)) throw new Error('Некорректная ссылка Яндекс.Диска.')
    const response = await fetch(data.upload!.href, { method: 'PUT', body: file, headers: { 'Content-Type': 'application/octet-stream' } })
    if (!response.ok && response.status !== 409) throw new Error(`Яндекс.Диск отклонил фото: HTTP ${response.status}.`)
    const latest = await getDocFromServer(ref)
    if (latest.data()?.status === 'awaiting-upload' && latest.data()?.upload?.href === data.upload!.href) {
      await updateDoc(ref, { status: 'uploaded' })
    }
  })()
  active.set(id, job)
  void job.catch(() => {}).finally(() => { if (active.get(id) === job) active.delete(id) })
}
