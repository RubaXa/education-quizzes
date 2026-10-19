/**
 * Queue handlers and bounded compatibility discovery for direct uploads.
 * The queue consumer owns the only Firestore subscription. This module never
 * watches source documents; reconciliation publishes missing events in pages.
 * @see ../../docs/services/upload-worker/README.md
 * @see ../../docs/modules/materials/family-library.md
 * @see ../../docs/modules/synchronization/event-queue.md
 */
import { createHash } from 'node:crypto'
import { FieldValue, Timestamp } from '@google-cloud/firestore'
import { stageEducationEvent, publishEducationEvent } from './event-queue.mjs'
import { createEducationEventId } from '../education-events/envelope.mjs'
import { matchesPhoto, validPhotoRequest, validUploadHref, workPath } from '../../storage/direct-upload.mjs'
import { familyBookPath, matchesFamilyBook, validFamilyBookRequest } from '../../storage/family-book-upload.mjs'
import { bookDisplayTitle } from '../../storage/textbook-catalog.mjs'
import { projectPublishedBookToFamily } from '../../storage/family-book-projection.mjs'

const activeStatuses = Object.freeze(['requested', 'awaiting-upload', 'uploaded', 'deleted', 'pending'])
const bookStatuses = Object.freeze(['requested', 'awaiting-upload', 'uploaded', 'needs-identification'])
const defaultPageSize = 100
const renewAfterMs = 10 * 60_000
const deleteGraceMs = 20 * 60_000
const wrapCursor = Symbol('wrap-cursor')

/**
 * Build handlers keyed by queue event type. Pass these into the single
 * EducationEventConsumer; the factory deliberately has no listeners or timers.
 */
export function createUploadBrokerHandlers({ db, disk, logger = () => {}, clock = () => Date.now() }) {
  if (!db || !disk) throw new TypeError('Upload broker requires Firestore and disk adapters.')
  return {
    'upload.transfer_requested': (event) => handlePhotoEvent({ db, disk, event, logger, clock }),
    'upload.bytes_uploaded': (event) => handlePhotoEvent({ db, disk, event, logger, clock }),
    'upload.delete_requested': (event) => handlePhotoEvent({ db, disk, event, logger, clock }),
    'material.upload_requested': (event) => handleBookEvent({ db, disk, event, logger, clock }),
    'material.bytes_uploaded': (event) => handleBookEvent({ db, disk, event, logger, clock }),
  }
}

/**
 * Bounded compatibility producer for clients that still mutate source docs
 * without appending queue events. Each invocation reads at most one page per
 * publishes only to educationEvents; it never subscribes to source paths.
 */
export function createUploadReconciliationProducer({ db, pageSize = defaultPageSize, clock = () => Date.now(),
  publish = publishEducationEvent, logger = () => {}, intervalMs = 15_000, setTimer = setInterval, clearTimer = clearInterval }) {
  if (!db || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 250 || intervalMs < 1_000) {
    throw new TypeError('Invalid upload reconciliation configuration.')
  }
  const cursors = new Map()
  let timer = null
  let running = null
  let stopped = false

  async function scanGroup(groupName, statuses, processDocument) {
    let query = db.collectionGroup(groupName).where('status', 'in', statuses).orderBy('__name__').limit(pageSize)
    const cursor = cursors.get(groupName)
    if (cursor && cursor !== wrapCursor) query = query.startAfter(cursor)
    const snapshot = await query.get()
    if (snapshot.docs.length === pageSize) cursors.set(groupName, snapshot.docs.at(-1))
    else if (cursor && cursor !== wrapCursor) cursors.set(groupName, wrapCursor)
    else cursors.delete(groupName)
    for (const document of snapshot.docs) {
      if (stopped) return
      try { await processDocument(document) }
      catch (error) {
        logger({ event: 'upload_reconciliation_item_failed', sourceKind: groupName === 'files' ? 'photo' : 'book',
          safeCode: error?.safeCode ?? 'reconciliation_item_failed' })
      }
    }
    return snapshot.size
  }

  async function runOne() {
    if (stopped) return { photo: 0, book: 0 }
    if (running) return running
    running = (async () => {
      let photo = 0, book = 0
      photo = await scanGroup('files', activeStatuses, (snapshot) => reconcilePhoto({ db, publish, snapshot, clock })) ?? 0
      book = await scanGroup('bookUploads', bookStatuses, (snapshot) => reconcileBook({ db, publish, snapshot, clock })) ?? 0
      return { photo, book }
    })().finally(() => { running = null })
    return running
  }

  return {
    runOne,
    start() {
      if (timer || stopped) return
      void runOne().catch((error) => logger({ event: 'upload_reconciliation_failed', safeCode: error?.safeCode ?? 'reconciliation_failed' }))
      timer = setTimer(() => {
        void runOne().catch((error) => logger({ event: 'upload_reconciliation_failed', safeCode: error?.safeCode ?? 'reconciliation_failed' }))
      }, intervalMs)
      timer?.unref?.()
    },
    async stop() {
      stopped = true
      if (timer) clearTimer(timer)
      timer = null
      await running
    },
  }
}

/** Convenient runtime factory; the caller constructs the disk adapter once. */
export function createUploadBroker({ db, disk, logger, clock, reconciliation = {} }) {
  return {
    handlers: createUploadBrokerHandlers({ db, disk, logger, clock }),
    reconciler: createUploadReconciliationProducer({ db, logger, clock, ...reconciliation }),
  }
}

async function handlePhotoEvent({ db, disk, event, logger, clock }) {
  const parsed = parsePhotoPath(event?.sourceRef?.documentPath)
  if (!parsed || event.sourceRef.kind !== 'upload' || event.sourceRef.dayToken !== parsed.studentToken
    || event.sourceRef.recordId !== parsed.uploadId) return { state: 'blocked', safeErrorCode: 'invalid_upload_source' }
  const ref = db.doc(event.sourceRef.documentPath)
  const ownerRef = db.doc(`dayOwners/${parsed.studentToken}`)
  const [ownerSnapshot, pageSnapshot, uploadSnapshot] = await Promise.all([
    ownerRef.get(), db.doc(`dayPages/${parsed.studentToken}`).get(), ref.get(),
  ])
  if (!ownerSnapshot.exists || !uploadSnapshot.exists) return
  const owner = ownerSnapshot.data() ?? {}
  const request = uploadSnapshot.data() ?? {}
  if (owner.familyId !== event.familyId || owner.childId !== event.childId) return { state: 'blocked', safeErrorCode: 'upload_owner_changed' }
  if (!request.sha256) return

  if (request.status === 'deleted' || event.eventType === 'upload.delete_requested') {
    const path = safeWorkPath(owner, parsed.studentToken, parsed.uploadId, request.contentType)
    const remote = await disk.head(path)
    if (remote?.type === 'file' && remote.md5) await disk.removeWorkAt(path, remote.md5)
    const deletedAt = timestampMillis(request.deletedAt) ?? timestampMillis(request.upload?.issuedAt) ?? 0
    if (clock() - deletedAt < deleteGraceMs) {
      const error = new Error('Upload deletion grace period is active.')
      error.safeCode = 'upload_delete_grace_period'
      throw error
    }
    const latest = await ref.get()
    if (latest.data()?.status === 'deleted') await ref.delete()
    return
  }

  if (request.status === 'upload-error') {
    const path = safeWorkPath(owner, parsed.studentToken, parsed.uploadId, request.contentType)
    const remote = await disk.head(path)
    if (remote?.type === 'file' && remote.md5) await disk.removeWorkAt(path, remote.md5)
    return
  }
  if (!['requested', 'awaiting-upload', 'uploaded'].includes(request.status)) return
  if (request.status === 'uploaded' && event.eventType === 'upload.transfer_requested') return
  if (!(await authorizedPhoto(db, owner, pageSnapshot.data(), request))) {
    const deniedPath = safeWorkPath(owner, parsed.studentToken, parsed.uploadId, request.contentType)
    const remote = await disk.head(deniedPath)
    if (remote?.type === 'file' && remote.md5) await disk.removeWorkAt(deniedPath, remote.md5)
    await ref.update({ status: 'upload-error', error: 'Задание изменилось или личный доступ больше не действует.' })
    return
  }
  const path = workPath(owner, parsed.studentToken, parsed.uploadId, request.contentType)
  if (await finishPhoto({ db, disk, ref, event, request, path })) return

  if (request.status === 'uploaded' || event.eventType === 'upload.bytes_uploaded') throw safeError('upload_bytes_not_visible')
  if (request.status === 'awaiting-upload') {
    const issuedAt = timestampMillis(request.upload?.issuedAt) ?? 0
    if (clock() - issuedAt < renewAfterMs) return
  }
  await ensureParent(disk, path)
  const link = await disk.request('GET', 'resources/upload', path, { overwrite: false })
  if (link?.method !== 'PUT' || !validUploadHref(link.href)) throw safeError('upload_link_unavailable')
  await ref.update({ status: 'awaiting-upload', upload: { href: link.href, issuedAt: Timestamp.now() } })
  logger({ event: 'upload_link_issued', kind: 'photo' })
}

async function finishPhoto({ db, disk, ref, event, request, path }) {
  const remote = await disk.head(path)
  if (remote?.type !== 'file') return false
  if (remote.size !== request.size || !remote.md5) throw safeError('upload_size_mismatch')
  const bytes = await disk.getAt(path)
  if (!matchesPhoto(bytes, request)) throw safeError('upload_content_mismatch')
  const publicUrl = await disk.publish(path)
  const md5 = createHash('md5').update(bytes).digest('hex')
  const sourceRef = event.sourceRef
  const confirmed = {
    eventType: 'upload.confirmed', familyId: event.familyId, childId: event.childId,
    source: 'firestore', sourceRef, operationId: `upload-confirmed:${ref.id}`, actor: { type: 'system', id: 'server' },
  }
  const result = await db.runTransaction(async (tx) => {
    const currentSnapshot = await tx.get(ref)
    if (!currentSnapshot.exists) return { done: true, cleanup: true }
    const current = currentSnapshot.data() ?? {}
    if (current.status === 'pending' && current.sha256 === request.sha256) return { done: true }
    if (current.status === 'deleted' || !['awaiting-upload', 'uploaded', 'requested'].includes(current.status)
      || current.sha256 !== request.sha256) return { done: true, cleanup: true }
    if (!(await photoAuthorizedInTransaction(tx, db, event, current))) {
      tx.update(ref, { status: 'upload-error', error: 'Задание изменилось или личный доступ больше не действует.' })
      return { done: true, cleanup: true }
    }
    const staged = await stageEducationEvent(tx, db, confirmed)
    tx.update(ref, { status: 'pending', storage: { provider: 'yandex-disk', state: 'stored', path,
      size: bytes.length, md5, sha256: request.sha256, publicUrl, syncedAt: Timestamp.now() },
    upload: FieldValue.delete(), error: FieldValue.delete(), eventProducerVersion: 1, eventReceiptId: staged.eventId })
    return { done: true }
  })
  if (result?.cleanup) await disk.removeWorkAt(path, remote.md5)
  return Boolean(result?.done)
}

async function handleBookEvent({ db, disk, event, logger, clock }) {
  const parsed = parseBookPath(event?.sourceRef?.documentPath)
  if (!parsed || event.sourceRef.kind !== 'material' || event.sourceRef.recordId !== parsed.uploadId
    || parsed.familyId !== event.familyId || parsed.childId !== event.childId) return { state: 'blocked', safeErrorCode: 'invalid_material_source' }
  const ref = db.doc(event.sourceRef.documentPath)
  const requestSnapshot = await ref.get()
  if (!requestSnapshot.exists) return
  const request = requestSnapshot.data() ?? {}
  if (!bookStatuses.includes(request.status)) return
  if (request.status === 'uploaded' && event.eventType === 'material.upload_requested') return
  if (!(await authorizedFamilyBook(db, parsed.familyId, parsed.childId, request))) {
    await ref.update({ status: 'upload-error', error: 'Личный доступ родителя или связь с ребёнком больше не действуют.' })
    return
  }
  const path = familyBookPath(parsed.familyId, parsed.childId, parsed.uploadId, request.contentType)
  if (await finishFamilyBook({ db, disk, ref, event, familyId: parsed.familyId, childId: parsed.childId, request, path, logger })) return
  const latestRequest = (await ref.get()).data() ?? {}
  if (!bookStatuses.includes(latestRequest.status) || latestRequest.sha256 !== request.sha256) return
  if (request.status === 'uploaded' || event.eventType === 'material.bytes_uploaded') throw safeError('material_bytes_not_visible')
  if (request.status === 'awaiting-upload') {
    const issuedAt = timestampMillis(request.upload?.issuedAt) ?? 0
    if (clock() - issuedAt < renewAfterMs) return
  }
  await ensureParent(disk, path)
  const link = await disk.request('GET', 'resources/upload', path, { overwrite: false })
  if (link?.method !== 'PUT' || !validUploadHref(link.href)) throw safeError('upload_link_unavailable')
  await ref.update({ status: 'awaiting-upload', upload: { href: link.href, issuedAt: Timestamp.now() } })
  logger({ event: 'upload_link_issued', kind: 'book' })
}

async function finishFamilyBook({ db, disk, ref, event, familyId, childId, request, path, logger }) {
  const remote = await disk.head(path)
  if (remote?.type !== 'file') return false
  if (remote.size !== request.size) throw safeError('material_size_mismatch')
  const bytes = await disk.getAt(path)
  if (!matchesFamilyBook(bytes, request)) throw safeError('material_content_mismatch')
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
      throw safeError('shared_material_missing')
    }
  } else await disk.putAt(sharedPath, bytes, md5)
  await db.doc(`storedObjects/${request.sha256}`).set({ sha256: request.sha256, path: sharedPath,
    size: bytes.length, md5, contentType: request.contentType, storedAt: Timestamp.now() }, { merge: true })
  const storage = { provider: 'yandex-disk', state: 'stored', path: sharedPath, size: bytes.length,
    sha256: request.sha256, md5, syncedAt: Timestamp.now() }
  const bindingRef = book ? db.doc(`families/${familyId}/children/${childId}/books/${book.id}`) : null
  const ready = { eventType: 'material.ready', familyId, childId, source: 'firestore', sourceRef: event.sourceRef,
    operationId: `material-ready:${ref.id}`, actor: { type: 'system', id: 'server' } }
  const committed = await db.runTransaction(async (tx) => {
    const currentSnapshot = await tx.get(ref)
    if (!currentSnapshot.exists) return false
    const current = currentSnapshot.data() ?? {}
    if (!bookStatuses.includes(current.status) || current.sha256 !== request.sha256) return false
    if (!(await familyBookAuthorizedInTransaction(tx, db, familyId, childId, current))) {
      tx.update(ref, { status: 'upload-error', error: 'Личный доступ родителя или связь с ребёнком больше не действуют.' })
      return false
    }
    const staged = await stageEducationEvent(tx, db, ready)
    if (bindingRef) {
      tx.set(bindingRef, {
        bookId: book.id, subjectKey: request.subjectKey,
        title: book.data().title ?? bookDisplayTitle({ id: book.id, ...book.data() }),
        status: book.data().editionStatus === 'parallel-edition' ? 'provisional' : 'confirmed',
        sourceSha256: request.sha256, catalogSha256: book.data().sourceSha256,
        evidence: { kind: 'exact-file-sha256', uploadId: ref.id }, confirmedAt: Timestamp.now(),
      }, { merge: true })
    }
    tx.update(ref, { status: bindingRef ? 'linked' : 'needs-identification', ...(bindingRef ? { bookId: book.id } : {}),
      storage, upload: FieldValue.delete(), error: FieldValue.delete(), eventProducerVersion: 1, eventReceiptId: staged.eventId })
    return true
  })
  if (!committed) return false
  if (bindingRef) {
    try {
      const result = await projectPublishedBookToFamily(db, bindingRef)
      logger({ event: 'family_book_projection', status: result.status, pages: result.pages ?? 0 })
    } catch {
      // Binding and receipt persist; ordinary family page sync can finish later.
      logger({ event: 'family_book_projection_pending' })
    }
  }
  try { await disk.removeFamilyBookStagingAt(path, md5) }
  catch { logger({ event: 'family_book_staging_cleanup_pending' }) }
  return true
}

async function reconcilePhoto({ db, publish, snapshot, clock }) {
  const parsed = parsePhotoPath(snapshot.ref.path)
  if (!parsed) return
  const request = snapshot.data() ?? {}
  const owner = (await db.doc(`dayOwners/${parsed.studentToken}`).get()).data() ?? {}
  if (!owner.familyId || !owner.childId) return
  const base = { familyId: owner.familyId, childId: owner.childId, source: 'firestore',
    sourceRef: { kind: 'upload', documentPath: snapshot.ref.path, dayToken: parsed.studentToken, recordId: parsed.uploadId, ...(request.taskId ? { taskId: request.taskId } : {}) },
    actor: { type: 'system', id: 'server' } }
  let input = null
  if (request.status === 'requested') input = { ...base, eventType: 'upload.transfer_requested', operationId: `upload-transfer:${parsed.uploadId}:requested` }
  else if (request.status === 'uploaded') input = { ...base, eventType: 'upload.bytes_uploaded', operationId: `upload-transfer:${parsed.uploadId}:uploaded` }
  else if (request.status === 'pending' && request.storage?.state === 'stored') {
    input = { ...base, eventType: 'upload.confirmed', operationId: `upload-confirmed:${parsed.uploadId}` }
  }
  else if (request.status === 'deleted') input = { ...base, eventType: 'upload.delete_requested', operationId: `upload-delete:${parsed.uploadId}` }
  else if (request.status === 'awaiting-upload') {
    const issuedAt = timestampMillis(request.upload?.issuedAt) ?? 0
    if (clock() - issuedAt >= renewAfterMs) input = { ...base, eventType: 'upload.transfer_requested',
      operationId: `upload-transfer:${parsed.uploadId}:renew:${Math.floor(issuedAt / renewAfterMs)}` }
  }
  if (!input) return
  const eventId = await publishEventId(input)
  if (request.eventReceiptId === eventId) return
  await publish(db, input)
}

async function reconcileBook({ db, publish, snapshot, clock }) {
  const parsed = parseBookPath(snapshot.ref.path)
  if (!parsed) return
  const request = snapshot.data() ?? {}
  const base = { familyId: parsed.familyId, childId: parsed.childId, source: 'firestore',
    sourceRef: { kind: 'material', documentPath: snapshot.ref.path, recordId: parsed.uploadId },
    actor: { type: 'system', id: 'server' } }
  let input = null
  if (request.status === 'requested') input = { ...base, eventType: 'material.upload_requested', operationId: `material-upload:${parsed.uploadId}` }
  else if (request.status === 'uploaded') input = { ...base, eventType: 'material.bytes_uploaded', operationId: `material-upload:${parsed.uploadId}:uploaded` }
  else if (request.status === 'needs-identification' && request.storage?.state === 'stored') {
    input = { ...base, eventType: 'material.ready', operationId: `material-ready:${parsed.uploadId}` }
  }
  else if (request.status === 'awaiting-upload') {
    const issuedAt = timestampMillis(request.upload?.issuedAt) ?? 0
    if (clock() - issuedAt >= renewAfterMs) input = { ...base, eventType: 'material.upload_requested',
      operationId: `material-upload:${parsed.uploadId}:renew:${Math.floor(issuedAt / renewAfterMs)}` }
  }
  if (!input) return
  const eventId = await publishEventId(input)
  if (request.eventReceiptId === eventId) return
  await publish(db, input)
}

async function publishEventId(input) { return createEducationEventId(input) }

async function authorizedPhoto(db, owner, page, request) {
  if (!validPhotoRequest(request, page) || page.date !== owner.date) return false
  const session = (await db.doc(`deviceSessions/${request.deviceUid}`).get()).data()
  if (!session?.linkToken) return false
  const grant = (await db.doc(`accessLinks/${session.linkToken}`).get()).data()
  if (!grant?.active || !grant.personId) return false
  const member = (await db.doc(`families/${owner.familyId}/members/${grant.personId}`).get()).data()
  return member?.active === true && member.role === 'student' && member.childIds?.includes(owner.childId)
}

async function authorizedFamilyBook(db, familyId, childId, request) {
  if (!validFamilyBookRequest(request, childId)) return false
  const session = (await db.doc(`deviceSessions/${request.deviceUid}`).get()).data()
  if (!session?.linkToken) return false
  const grant = (await db.doc(`accessLinks/${session.linkToken}`).get()).data()
  if (!grant?.active || !grant.personId) return false
  const member = (await db.doc(`families/${familyId}/members/${grant.personId}`).get()).data()
  return member?.active === true && member.role === 'parent' && member.childIds?.includes(childId)
}

async function photoAuthorizedInTransaction(tx, db, event, request) {
  const studentToken = event.sourceRef.dayToken
  const [ownerSnapshot, pageSnapshot] = await Promise.all([
    tx.get(db.doc(`dayOwners/${studentToken}`)), tx.get(db.doc(`dayPages/${studentToken}`)),
  ])
  if (!ownerSnapshot.exists || !pageSnapshot.exists) return false
  const owner = ownerSnapshot.data() ?? {}, page = pageSnapshot.data() ?? {}
  if (owner.familyId !== event.familyId || owner.childId !== event.childId
    || !validPhotoRequest(request, page) || page.date !== owner.date) return false
  const sessionSnapshot = await tx.get(db.doc(`deviceSessions/${request.deviceUid}`))
  const session = sessionSnapshot.data() ?? {}
  if (!session.linkToken) return false
  const grantSnapshot = await tx.get(db.doc(`accessLinks/${session.linkToken}`))
  const grant = grantSnapshot.data() ?? {}
  if (!grant.active || !grant.personId || grant.personId.includes('/')) return false
  const memberSnapshot = await tx.get(db.doc(`families/${owner.familyId}/members/${grant.personId}`))
  const member = memberSnapshot.data() ?? {}
  return member.active === true && member.role === 'student' && member.childIds?.includes(owner.childId)
}

async function familyBookAuthorizedInTransaction(tx, db, familyId, childId, request) {
  if (!validFamilyBookRequest(request, childId)) return false
  const sessionSnapshot = await tx.get(db.doc(`deviceSessions/${request.deviceUid}`))
  const session = sessionSnapshot.data() ?? {}
  if (!session.linkToken) return false
  const grantSnapshot = await tx.get(db.doc(`accessLinks/${session.linkToken}`))
  const grant = grantSnapshot.data() ?? {}
  if (!grant.active || !grant.personId || grant.personId.includes('/')) return false
  const memberSnapshot = await tx.get(db.doc(`families/${familyId}/members/${grant.personId}`))
  const member = memberSnapshot.data() ?? {}
  return member.active === true && member.role === 'parent' && member.childIds?.includes(childId)
}

async function ensureParent(disk, path) {
  const parts = path.slice('app:/'.length).split('/')
  for (let length = 1; length < parts.length; length += 1) await disk.ensureFolder(`app:/${parts.slice(0, length).join('/')}`)
}

function parsePhotoPath(path) {
  const match = /^dayUploads\/([^/]+)\/files\/([^/]+)$/.exec(path ?? '')
  return match ? { studentToken: match[1], uploadId: match[2] } : null
}
function parseBookPath(path) {
  const match = /^families\/([^/]+)\/children\/([^/]+)\/bookUploads\/([^/]+)$/.exec(path ?? '')
  return match ? { familyId: match[1], childId: match[2], uploadId: match[3] } : null
}
function safeWorkPath(owner, studentToken, uploadId, contentType) {
  try { return workPath(owner, studentToken, uploadId, contentType) } catch { throw safeError('invalid_upload_source') }
}
function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const parsed = typeof value === 'string' || value instanceof Date ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}
function safeError(code) { const error = new Error(code); error.safeCode = code; return error }
