import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { matchesPhoto, validPhotoRequest, validUploadHref, workPath } from '../storage/direct-upload.mjs'
import { familyBookPath, matchesFamilyBook, validFamilyBookRequest } from '../storage/family-book-upload.mjs'
import { bookDisplayTitle } from '../storage/textbook-catalog.mjs'
import { projectPublishedBookToFamily } from '../storage/family-book-projection.mjs'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'

/** Long-running local broker. It never receives image bytes from Firestore.
 * @see ../docs/architecture/local-first-sync.md#operator-upload-index
 */
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
const bookBusy = new Set()

async function authorizedFamilyBook(familyId, childId, request) {
  if (!validFamilyBookRequest(request, childId)) return false
  const session = (await db.doc(`deviceSessions/${request.deviceUid}`).get()).data()
  if (!session?.linkToken) return false
  const grant = (await db.doc(`accessLinks/${session.linkToken}`).get()).data()
  if (!grant?.active || !grant.personId) return false
  const member = (await db.doc(`families/${familyId}/members/${grant.personId}`).get()).data()
  return member?.active === true && member.role === 'parent' && member.childIds?.includes(childId)
}

async function finishFamilyBook(ref, familyId, childId, path, request) {
  const remote = await disk.head(path)
  if (remote?.type !== 'file') return false
  if (remote.size !== request.size) throw new Error('Размер учебника на Диске не совпадает с заявкой.')
  const bytes = await disk.getAt(path)
  if (!matchesFamilyBook(bytes, request)) throw new Error('Хэш или формат учебника не совпадает с исходным файлом.')
  const current = (await ref.get()).data()
  if (!['requested', 'awaiting-upload', 'uploaded'].includes(current?.status) || current.sha256 !== request.sha256) return true
  const matches = await db.collection('materialBooks').where('sourceSha256', '==', request.sha256).get()
  const book = matches.docs.find((item) => item.data().role === 'student-textbook'
    && item.data().subject?.toLocaleLowerCase('ru') === request.subjectKey)
  const md5 = createHash('md5').update(bytes).digest('hex')
  const knownObject = (await db.doc(`storedObjects/${request.sha256}`).get()).data()
  const knownPath = knownObject?.path ?? book?.data().privateDiskPath
  const extension = path.slice(path.lastIndexOf('.') + 1)
  const sharedPath = knownPath ?? `app:/PETR/Учебники/Общий архив/${request.sha256.slice(0, 2)}/${request.sha256}.${extension}`
  if (knownPath) {
    const existing = await disk.head(knownPath)
    if (existing?.type !== 'file' || existing.size !== bytes.length || existing.md5?.toLowerCase() !== md5) {
      throw new Error('Общий оригинал с таким хэшем отсутствует или повреждён.')
    }
  } else await disk.putAt(sharedPath, bytes, md5)
  await db.doc(`storedObjects/${request.sha256}`).set({ sha256: request.sha256, path: sharedPath,
    size: bytes.length, md5, contentType: request.contentType, storedAt: Timestamp.now() }, { merge: true })
  const storage = { provider: 'yandex-disk', state: 'stored', path: sharedPath, size: bytes.length,
    sha256: request.sha256, md5, syncedAt: Timestamp.now() }
  if (book) {
    const batch = db.batch()
    const bindingRef = db.doc(`families/${familyId}/children/${childId}/books/${book.id}`)
    batch.set(bindingRef, {
      bookId: book.id, subjectKey: request.subjectKey,
      title: book.data().title ?? bookDisplayTitle({ id: book.id, ...book.data() }),
      status: book.data().editionStatus === 'parallel-edition' ? 'provisional' : 'confirmed',
      sourceSha256: request.sha256, catalogSha256: book.data().sourceSha256,
      evidence: { kind: 'exact-file-sha256', uploadId: ref.id }, confirmedAt: Timestamp.now(),
    }, { merge: true })
    batch.update(ref, { status: 'linked', bookId: book.id, storage, upload: FieldValue.delete(), error: FieldValue.delete() })
    await batch.commit()
    console.log(JSON.stringify({ event: 'family-book-deduplicated', familyId, childId, bookId: book.id }))
    try {
      const result = await projectPublishedBookToFamily(db, bindingRef)
      console.log(JSON.stringify({ event: 'family-book-pages', familyId, childId, ...result }))
    } catch (error) {
      // The binding remains queued for sync-family-pages; do not lose the PDF.
      console.error(JSON.stringify({ event: 'family-book-pages-pending', familyId, childId,
        bookId: book.id, reason: error instanceof Error ? error.message : String(error) }))
    }
  } else {
    await ref.update({ status: 'needs-identification', storage, upload: FieldValue.delete(), error: FieldValue.delete() })
    console.log(JSON.stringify({ event: 'family-book-needs-identification', familyId, childId, uploadId: ref.id }))
  }
  try { await disk.removeFamilyBookStagingAt(path, md5) }
  catch (error) { console.error(JSON.stringify({ event: 'family-book-staging-cleanup-pending', path, reason: error instanceof Error ? error.message : String(error) })) }
  return true
}

async function handleFamilyBook(ref) {
  if (bookBusy.has(ref.path)) return
  bookBusy.add(ref.path)
  try {
    const childId = ref.parent.parent?.id
    const familyId = ref.parent.parent?.parent.parent?.id
    if (!familyId || !childId) return
    const request = (await ref.get()).data()
    if (!['requested', 'awaiting-upload', 'uploaded'].includes(request?.status)) return
    if (!(await authorizedFamilyBook(familyId, childId, request))) {
      await ref.update({ status: 'upload-error', error: 'Личный доступ родителя или связь с ребёнком больше не действуют.' })
      return
    }
    const path = familyBookPath(familyId, childId, ref.id, request.contentType)
    if (await finishFamilyBook(ref, familyId, childId, path, request)) return
    const issuedAt = request.upload?.issuedAt?.toMillis?.() ?? 0
    if (request.status === 'awaiting-upload' && Date.now() - issuedAt < 10 * 60_000) return
    await ensureParent(path)
    const link = await disk.request('GET', 'resources/upload', path, { overwrite: false })
    if (link?.method !== 'PUT' || !validUploadHref(link.href)) throw new Error('Яндекс.Диск не выдал безопасную ссылку загрузки.')
    await ref.update({ status: 'awaiting-upload', upload: { href: link.href, issuedAt: Timestamp.now() } })
    setTimeout(() => { void handleFamilyBook(ref) }, 10 * 60_000)
  } catch (error) {
    console.error(JSON.stringify({ event: 'family-book-upload-error', path: ref.path, reason: error instanceof Error ? error.message : String(error) }))
    setTimeout(() => { void handleFamilyBook(ref) }, 15_000)
  } finally { bookBusy.delete(ref.path) }
}

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
    // Completed photos stay in Firestore for history, but the upload broker
    // only needs work in active phases. A restart must not reread every old
    // reviewed photo and then call ref.get() for it again.
    const stop = db.collection(`dayUploads/${owner.id}/files`)
      .where('status', 'in', ['requested', 'awaiting-upload', 'uploaded', 'deleted'])
      .onSnapshot((files) => {
      for (const change of files.docChanges()) if (change.type !== 'removed') void handle(owner, change.doc.ref)
    }, (error) => console.error(JSON.stringify({ event: 'upload-listener-error', day: owner.id, reason: error.message })))
    listeners.set(owner.id, stop)
  }
}, (error) => { console.error(JSON.stringify({ event: 'owner-listener-error', reason: error.message })); process.exit(1) })
console.log(JSON.stringify({ event: 'upload-bridge-listening' }))
const activeBookStatuses = ['requested', 'awaiting-upload', 'uploaded']
let legacyBookStop = null
let activeBookReady = false
function watchBookUploads(query, mode) {
  return query.onSnapshot((snapshot) => {
    if (mode === 'active' && !activeBookReady) {
      activeBookReady = true
      console.log(JSON.stringify({ event: 'family-book-active-listening', initialActive: snapshot.size }))
      // Keep the legacy listener until the filtered initial snapshot arrives.
      legacyBookStop?.()
      legacyBookStop = null
    }
    for (const change of snapshot.docChanges()) {
      if (change.type === 'removed' || !activeBookStatuses.includes(change.doc.data().status)) continue
      void handleFamilyBook(change.doc.ref)
    }
  }, (error) => {
    // The collection-group status index is built separately. Keep the old
    // discovery path until the index is ready so an upload never disappears.
    if (mode === 'active' && error.code === 9 && /index/i.test(error.message)) {
      console.warn(JSON.stringify({ event: 'family-book-active-index-pending', fallback: 'legacy-listener' }))
      if (!legacyBookStop) legacyBookStop = watchBookUploads(db.collectionGroup('bookUploads'), 'legacy')
      setTimeout(() => { watchBookUploads(db.collectionGroup('bookUploads')
        .where('status', 'in', activeBookStatuses), 'active') }, 5 * 60_000)
      return
    }
    console.error(JSON.stringify({ event: 'family-book-listener-error', mode, reason: error.message }))
    process.exit(1)
  })
}
watchBookUploads(db.collectionGroup('bookUploads').where('status', 'in', activeBookStatuses), 'active')
