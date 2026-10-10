import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { matchesPhoto, validPhotoRequest, validUploadHref, workPath } from '../storage/direct-upload.mjs'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'

/** Long-running local broker. It never receives image bytes from Firestore. */
const local = resolve('.local')
const adc = resolve(local, 'adc.json')
const diskToken = resolve(local, 'yandex-disk-token')
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) process.env.GOOGLE_APPLICATION_CREDENTIALS = adc
if (!existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS) || !existsSync(diskToken)) {
  throw new Error('Локальному приёмнику нужны .local/adc.json и .local/yandex-disk-token.')
}
initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
const db = getFirestore()
const disk = new YandexDiskStorage(readFileSync(diskToken, 'utf8').trim())
const busy = new Set()
const listeners = new Map()

async function authorized(owner, page, request) {
  if (!validPhotoRequest(request, page) || page.date !== owner.date) return false
  const session = (await db.doc(`deviceSessions/${request.deviceUid}`).get()).data()
  if (!session?.linkToken) return false
  const grant = (await db.doc(`accessLinks/${session.linkToken}`).get()).data()
  if (!grant?.active || !grant.personId) return false
  const member = (await db.doc(`families/${owner.familyId}/members/${grant.personId}`).get()).data()
  return member?.active === true && member.role === 'student' && member.childIds?.includes(owner.childId)
}

async function ensureParent(path) {
  const parts = path.slice('app:/'.length).split('/')
  for (let length = 1; length < parts.length; length += 1) {
    await disk.ensureFolder(`app:/${parts.slice(0, length).join('/')}`)
  }
}

async function finish(ref, path, request) {
  const remote = await disk.head(path)
  if (remote?.type !== 'file') return false
  if (remote.size !== request.size || !remote.md5) throw new Error('Файл на Диске не совпадает с заявленным размером.')
  const bytes = await disk.getAt(path)
  if (!matchesPhoto(bytes, request)) throw new Error('Файл на Диске не совпадает с исходным изображением.')
  const publicUrl = await disk.publish(path)
  const current = (await ref.get()).data()
  if (current?.status === 'deleted') {
    await disk.removeWorkAt(path, remote.md5)
    return true
  }
  if (!['awaiting-upload', 'uploaded', 'requested'].includes(current?.status) || current.sha256 !== request.sha256) return true
  await ref.update({ status: 'pending', storage: { provider: 'yandex-disk', state: 'stored', path,
    size: bytes.length, md5: createHash('md5').update(bytes).digest('hex'), sha256: request.sha256,
    publicUrl, syncedAt: Timestamp.now() }, upload: FieldValue.delete(), error: FieldValue.delete() })
  console.log(JSON.stringify({ event: 'ready-for-review', uploadId: ref.id, taskId: request.taskId }))
  return true
}

async function handle(ownerDoc, ref) {
  const lock = ref.path
  if (busy.has(lock)) return
  busy.add(lock)
  try {
    const fresh = await ref.get()
    if (!fresh.exists) return
    const request = fresh.data()
    if (!['requested', 'awaiting-upload', 'uploaded', 'deleted'].includes(request.status)) return
    if (!request.sha256) return // Older deletions are handled by the legacy storage cleanup.
    const owner = ownerDoc.data()
    const page = (await db.doc(`dayPages/${ownerDoc.id}`).get()).data()
    const path = workPath(owner, ownerDoc.id, ref.id, request.contentType)
    if (request.status === 'deleted') {
      const remote = await disk.head(path)
      if (remote?.type === 'file' && remote.md5) await disk.removeWorkAt(path, remote.md5)
      const issuedAt = request.upload?.issuedAt?.toMillis?.() ?? 0
      if (Date.now() - issuedAt >= 20 * 60_000) await ref.delete()
      else setTimeout(() => { void handle(ownerDoc, ref) }, Math.max(1000, issuedAt + 20 * 60_000 - Date.now()))
      return
    }
    if (!(await authorized(owner, page, request))) {
      await ref.update({ status: 'upload-error', error: 'Задание изменилось или личный доступ больше не действует.' })
      return
    }
    if (await finish(ref, path, request)) return
    const issuedAt = request.upload?.issuedAt?.toMillis?.() ?? 0
    if (request.status === 'awaiting-upload' && Date.now() - issuedAt < 10 * 60_000) return
    await ensureParent(path)
    const link = await disk.request('GET', 'resources/upload', path, { overwrite: false })
    if (link?.method !== 'PUT' || !validUploadHref(link.href)) throw new Error('Яндекс Диск не выдал безопасную ссылку загрузки.')
    await ref.update({ status: 'awaiting-upload', upload: { href: link.href, issuedAt: Timestamp.now() } })
    setTimeout(() => { void handle(ownerDoc, ref) }, 10 * 60_000)
  } catch (error) {
    console.error(JSON.stringify({ event: 'upload-bridge-error', uploadId: ref.id, reason: error instanceof Error ? error.message : String(error) }))
    setTimeout(() => { void handle(ownerDoc, ref) }, 15_000)
  } finally { busy.delete(lock) }
}

db.collection('dayOwners').onSnapshot((snapshot) => {
  const present = new Set(snapshot.docs.map((owner) => owner.id))
  for (const [id, stop] of listeners) if (!present.has(id)) { stop(); listeners.delete(id) }
  for (const owner of snapshot.docs) {
    if (listeners.has(owner.id)) continue
    const stop = db.collection(`dayUploads/${owner.id}/files`).onSnapshot((files) => {
      for (const change of files.docChanges()) if (change.type !== 'removed') void handle(owner, change.doc.ref)
    }, (error) => console.error(JSON.stringify({ event: 'upload-listener-error', day: owner.id, reason: error.message })))
    listeners.set(owner.id, stop)
  }
}, (error) => { console.error(JSON.stringify({ event: 'owner-listener-error', reason: error.message })); process.exit(1) })
console.log(JSON.stringify({ event: 'upload-bridge-listening' }))
