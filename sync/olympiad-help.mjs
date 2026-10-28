/** Transactional operator boundary for photo-based olympiad practice help.
 * @see ../docs/modules/assessments/olympiad-preparation.md#модель-урока-и-свидетельств
 * The caller must be a trusted server; these functions do not expose Firestore to clients.
 */
import { createHash } from 'node:crypto'

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value)
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function practiceAllowed(assignment, problem, catalog, child, problemId) {
  const grade = child?.olympiadEligibility
  return child && child.active !== false && assignment?.active === true && assignment.participationEnabled === true && Array.isArray(assignment.allowedProblemIds)
    && assignment.allowedProblemIds.includes(problemId) && catalog?.status === 'published' && catalog.practiceOnly === true
    && Array.isArray(catalog.gradeLevels) && grade?.verified === true && Number.isInteger(grade.grade)
    && grade.grade >= 1 && grade.grade <= 11 && catalog.gradeLevels.includes(grade.grade)
    && Array.isArray(catalog.allowedProblemIds) && catalog.allowedProblemIds.includes(problemId)
    && problem?.status === 'published' && problem.practiceOnly === true
}
function checkedIds(values) {
  if (!Array.isArray(values) || values.some(x => !id(x)) || new Set(values).size !== values.length) throw new Error('invalid-photo-selection')
  return values
}
function context(db, { familyId, childId, olympiadId, problemId, requestId }) {
  if (![familyId, childId, olympiadId, problemId, requestId].every(id)) throw new Error('invalid-identity')
  const base = `families/${familyId}/children/${childId}/olympiads/${olympiadId}`
  return { base, assignment: db.doc(base), problem: db.doc(`olympiadMaterials/${olympiadId}/problems/${problemId}`), request: db.doc(`${base}/helpRequests/${requestId}`) }
}
async function access(tx, db, c, args, roles = ['student']) {
  if (!id(args.uid)) throw new Error('unauthenticated')
  const session = (await tx.get(db.doc(`deviceSessions/${args.uid}`))).data()
  if (!/^[A-Za-z0-9_-]{43}$/.test(session?.linkToken ?? '')) throw new Error('unauthenticated')
  const link = (await tx.get(db.doc(`accessLinks/${session.linkToken}`))).data()
  if (!link?.active || !id(link.personId)) throw new Error('unauthenticated')
  const [family, child, member, assignment, problem, catalog] = await Promise.all([
    tx.get(db.doc(`families/${args.familyId}`)), tx.get(db.doc(`families/${args.familyId}/children/${args.childId}`)),
    tx.get(db.doc(`families/${args.familyId}/members/${link.personId}`)), tx.get(c.assignment), tx.get(c.problem),
    tx.get(db.doc(`olympiadCatalog/${args.olympiadId}`)),
  ])
  const m = member.data(), a = assignment.data(), p = problem.data()
  if (!family.exists || family.data()?.active === false || !child.exists || child.data()?.active === false || !m?.active || !roles.includes(m.role) || !m.childIds?.includes(args.childId)) throw new Error('permission-denied')
  if (!practiceAllowed(a, p, catalog.data(), child.data(), args.problemId)) throw new Error('practice-not-verified')
  return { personId: link.personId, role: m.role }
}
/** Append an immutable revision. A retry with the same operationId and payload is safe. */
export async function submitOlympiadHelp(db, args) {
  const c = context(db, args), photos = checkedIds(args.photoIds), note = args.note ?? ''
  if (!id(args.operationId) || typeof note !== 'string' || note.length > 2000) throw new Error('invalid-request')
  return db.runTransaction(async tx => {
    const { personId } = await access(tx, db, c, args)
    const refs = photos.map(photo => db.doc(`${c.base}/photos/${photo}`))
    const [current, ...files] = await Promise.all([tx.get(c.request), ...refs.map(ref => tx.get(ref))])
    if (files.some(file => !file.exists || file.data()?.problemId !== args.problemId || file.data()?.personId !== personId || file.data()?.status !== 'stored')) throw new Error('photo-not-available')
    const previous = current.data()
    if (previous && (previous.problemId !== args.problemId || previous.personId !== personId)) throw new Error('request-conflict')
    if (!photos.length && (!previous || !note.trim())) throw new Error('photo-or-additional-note-required')
    const fingerprint = hash({ photos, note, personId, problemId: args.problemId })
    const prior = previous?.revisions?.find(r => r.operationId === args.operationId)
    if (prior) { if (prior.fingerprint !== fingerprint) throw new Error('operation-conflict'); return { revision: prior.revision, reused: true } }
    // An answer continuation needs new evidence, not a replay of previous photos.
    if (previous?.status === 'answered' && !photos.some(photo => !previous.revisions.some(revision => revision.photoIds.includes(photo)))) throw new Error('new-photo-required')
    const revision = (previous?.revision ?? 0) + 1
    const record = { revision, operationId: args.operationId, fingerprint, photoIds: photos, note }
    tx.set(c.request, { problemId: args.problemId, personId, createdAt: previous?.createdAt ?? new Date().toISOString(), revision, revisions: [...(previous?.revisions ?? []), record],
      answers: previous?.answers ?? [], status: previous?.status === 'processing' ? 'processing' : 'requested',
      ...(previous?.processing ? { processing: previous.processing } : {}) })
    return { revision, reused: false }
  })
}

/** Register an existing server-issued transfer receipt; never accept a caller-supplied path. */
export async function registerOlympiadPhoto(db, args) {
  const c = context(db, { ...args, requestId: '_' })
  if (!id(args.receiptId)) throw new Error('invalid-receipt')
  return db.runTransaction(async tx => {
    const { personId } = await access(tx, db, c, args)
    const receiptRef = db.doc(`olympiadPhotoReceipts/${args.receiptId}`)
    const photoRef = db.doc(`${c.base}/photos/${args.receiptId}`)
    const [receiptDoc, photoDoc] = await Promise.all([tx.get(receiptRef), tx.get(photoRef)])
    const receipt = receiptDoc.data(), storage = receipt?.storage
    if (!receiptDoc.exists || receipt.familyId !== args.familyId || receipt.childId !== args.childId || receipt.olympiadId !== args.olympiadId
      || receipt.problemId !== args.problemId || receipt.personId !== personId || receipt.status !== 'stored'
      || storage?.provider !== 'yandex-disk' || storage.state !== 'stored'
      || !/^app:\/PETR\/Олимпиады\/[a-f0-9]{64}\/[a-f0-9]{64}\.(jpg|png|webp|heic|heif)$/.test(storage.path ?? '')
      || !/^[a-f0-9]{64}$/.test(storage.sha256 ?? '') || !photoFormats[receipt.mime]
      || storage.path !== `app:/PETR/Олимпиады/${hash([args.familyId, args.childId, args.olympiadId, args.problemId, args.receiptId])}/${storage.sha256}.${photoFormats[receipt.mime].extension}`) throw new Error('receipt-not-authorized')
    if (photoDoc.exists) {
      const existing = photoDoc.data()
      if (existing.problemId !== args.problemId || existing.personId !== personId || existing.receiptId !== args.receiptId
        || existing.storage?.sha256 !== storage.sha256 || existing.storage?.path !== storage.path) throw new Error('photo-conflict')
      return { photoId: args.receiptId, status: 'stored', reused: true }
    }
    tx.set(photoRef, { problemId: args.problemId, personId, status: 'stored', receiptId: args.receiptId,
      storage: { provider: storage.provider, state: storage.state, path: storage.path, sha256: storage.sha256 } })
    return { photoId: args.receiptId, status: 'stored', reused: false }
  })
}

/** Read a role-authorized projection; storage paths, receipts and fingerprints remain server-only. */
export async function readOlympiadHelp(db, args) {
  const c = context(db, args)
  return db.runTransaction(async tx => {
    const { personId, role } = await access(tx, db, c, args, ['student', 'parent'])
    const snap = await tx.get(c.request), request = snap.data()
    if (!snap.exists || request?.problemId !== args.problemId || (role === 'student' && request.personId !== personId)) throw new Error('request-not-found')
    return { status: request.status, revision: request.revision,
      revisions: (request.revisions ?? []).map(({ revision, photoIds, note }) => ({ revision, photoIds, note })),
      answers: (request.answers ?? []).map(({ revision, revisions, text }) => ({ revision, revisions, text })) }
  })
}

/** List only authorized practice tasks; no answer keys or unverified contest material. */
export async function listOlympiadProblems(db, args) {
  if (![args.familyId, args.childId, args.olympiadId].every(id)) throw new Error('invalid-identity')
  const { createFirestoreLessonAdapter } = await import('../olympiad/firestore-lesson-adapter.mjs')
  const adapter = createFirestoreLessonAdapter(db)
  const scope = { ...args, attemptId: 'catalog' }
  if (!await adapter.authorize({ uid: args.uid }, scope, 'view')) throw new Error('permission-denied')
  const catalog = (await db.doc(`olympiadCatalog/${args.olympiadId}`).get()).data()
  if (!Array.isArray(catalog?.allowedProblemIds) || !catalog.allowedProblemIds.every(id)) throw new Error('practice-not-verified')
  const result = []
  for (const problemId of catalog.allowedProblemIds) {
    const scoped = { ...args, problemId, requestId: '_' }, c = context(db, scoped)
    const problem = await db.runTransaction(async tx => {
      await access(tx, db, c, scoped, ['student', 'parent'])
      return (await tx.get(c.problem)).data()
    })
    if (typeof problem.title === 'string' && problem.title.trim() && typeof problem.statement === 'string' && problem.statement.trim())
      result.push({ id: problemId, title: problem.title, statement: problem.statement })
  }
  for (const problem of result) {
    const scoped = { ...args, problemId: problem.id, requestId: '_' }
    await db.runTransaction(tx => access(tx, db, context(db, scoped), scoped, ['student', 'parent']))
  }
  if (!await adapter.authorize({ uid: args.uid }, scope, 'view')) throw new Error('permission-denied')
  return result
}

/** Family projection of the existing gallery and request index, without storage paths. */
export async function listOlympiadHelp(db, args) {
  const c = context(db, { ...args, requestId: '_' })
  const allowed = () => db.runTransaction(tx => access(tx, db, c, args, ['student', 'parent']))
  const actor = await allowed()
  const [photos, requests] = await Promise.all([db.collection(`${c.base}/photos`).get(), db.collection(`${c.base}/helpRequests`).get()])
  const visible = data => data?.problemId === args.problemId && (actor.role === 'parent' || data.personId === actor.personId)
  const result = { photos: photos.docs.filter(doc => id(doc.id) && visible(doc.data()) && doc.data().status === 'stored').map(doc => ({ id: doc.id })),
    requests: requests.docs.filter(doc => id(doc.id) && visible(doc.data())).sort((a,b) => String(a.data().createdAt ?? '').localeCompare(String(b.data().createdAt ?? '')) || a.id.localeCompare(b.id)).map(doc => ({ requestId: doc.id, status: doc.data().status, revision: doc.data().revision })) }
  const after = await allowed()
  if (after.personId !== actor.personId || after.role !== actor.role) throw new Error('permission-denied')
  return result
}
/** Freeze the exact evidence for the next operator response. No content is sent to a model. */
export async function startOlympiadHelp(db, args) {
  const c = context(db, args)
  if (!id(args.operationId)) throw new Error('invalid-request')
  return db.runTransaction(async tx => {
    const [assignment, problem, snap, catalog, child, family] = await Promise.all([tx.get(c.assignment), tx.get(c.problem), tx.get(c.request), tx.get(db.doc(`olympiadCatalog/${args.olympiadId}`)), tx.get(db.doc(`families/${args.familyId}/children/${args.childId}`)), tx.get(db.doc(`families/${args.familyId}`))])
    if (!family.exists || family.data()?.active === false || !practiceAllowed(assignment.data(), problem.data(), catalog.data(), child.data(), args.problemId)) throw new Error('practice-not-verified')
    const request = snap.data()
    if (!request || request.problemId !== args.problemId) throw new Error('request-not-found')
    if (request.processing?.operationId === args.operationId) return request.processing
    if (request.status !== 'requested' || request.processing) throw new Error('request-not-pending')
    const processing = { operationId: args.operationId, revision: request.revision, revisions: request.revisions.filter(r => r.revision <= request.revision).map(r => r.revision) }
    tx.update(c.request, { status: 'processing', processing })
    return processing
  })
}
/** Finish a frozen response; additions during processing remain queued. */
export async function finishOlympiadHelp(db, args) {
  const c = context(db, args)
  if (!id(args.operationId) || typeof args.answer !== 'string' || !args.answer.trim() || args.answer.length > 8000) throw new Error('invalid-answer')
  return db.runTransaction(async tx => {
    const [assignment, problem, snap, catalog, child, family] = await Promise.all([tx.get(c.assignment), tx.get(c.problem), tx.get(c.request), tx.get(db.doc(`olympiadCatalog/${args.olympiadId}`)), tx.get(db.doc(`families/${args.familyId}/children/${args.childId}`)), tx.get(db.doc(`families/${args.familyId}`))])
    if (!family.exists || family.data()?.active === false || !practiceAllowed(assignment.data(), problem.data(), catalog.data(), child.data(), args.problemId)) throw new Error('practice-not-verified')
    const request = snap.data(), prior = request?.answers?.find(a => a.operationId === args.operationId)
    if (prior) { if (prior.text !== args.answer) throw new Error('operation-conflict'); return { reused: true, revision: prior.revision } }
    if (!request || request.problemId !== args.problemId || request.processing?.operationId !== args.operationId) throw new Error('processing-mismatch')
    const answer = { operationId: args.operationId, revision: request.processing.revision, revisions: request.processing.revisions, text: args.answer }
    tx.update(c.request, { answers: [...request.answers, answer], status: request.revision > answer.revision ? 'requested' : 'answered', processing: null })
    return { reused: false, revision: answer.revision }
  })
}

const photoFormats = {
  'image/jpeg': { extension: 'jpg', matches: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { extension: 'png', matches: b => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
  'image/webp': { extension: 'webp', matches: b => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  'image/heic': { extension: 'heic', matches: b => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx)$/.test(b.toString('ascii', 8, 12)) },
  'image/heif': { extension: 'heif', matches: b => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp' && /^(mif1|msf1)$/.test(b.toString('ascii', 8, 12)) },
}

/** Trusted upload endpoint service. Never publishes a Yandex public URL. */
export async function transferOlympiadPhoto(db, storage, args, bytes) {
  const c = context(db, { ...args, requestId: '_' }), format = photoFormats[args.mime]
  if (!id(args.receiptId) || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 25_000_000 || !format?.matches(bytes)) throw new Error('invalid-photo')
  if (typeof storage?.putAt !== 'function' || typeof storage?.head !== 'function') throw new Error('storage-unavailable')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const scoped = hash([args.familyId, args.childId, args.olympiadId, args.problemId, args.receiptId])
  const path = `app:/PETR/Олимпиады/${scoped}/${sha256}.${format.extension}`
  // Authenticate before network IO. An identical committed receipt allows safe retries.
  const before = await db.runTransaction(async tx => {
    const { personId } = await access(tx, db, c, args)
    const snap = await tx.get(db.doc(`olympiadPhotoReceipts/${args.receiptId}`))
    if (snap.exists) {
      const r = snap.data()
      if (r.familyId !== args.familyId || r.childId !== args.childId || r.olympiadId !== args.olympiadId || r.problemId !== args.problemId
        || r.personId !== personId || r.storage?.sha256 !== sha256 || r.storage?.path !== path || r.mime !== args.mime) throw new Error('receipt-conflict')
    }
    return { personId, alreadyStored: snap.exists }
  })
  if (!before.alreadyStored) {
    const result = await storage.putAt(path, bytes)
    if (result?.provider !== 'yandex-disk' || result.path !== path || result.size !== bytes.length) throw new Error('storage-not-confirmed')
    const remote = await storage.head(path)
    if (remote?.type !== 'file' || remote.public_url || remote.size !== bytes.length || typeof remote.md5 !== 'string'
      || remote.md5.toLowerCase() !== createHash('md5').update(bytes).digest('hex')) throw new Error('storage-not-confirmed')
    await db.runTransaction(async tx => {
      const { personId } = await access(tx, db, c, args)
      if (personId !== before.personId) throw new Error('permission-denied')
      const ref = db.doc(`olympiadPhotoReceipts/${args.receiptId}`), existing = await tx.get(ref)
      if (existing.exists) {
        const r = existing.data()
        if (r.personId !== personId || r.storage?.path !== path || r.storage?.sha256 !== sha256 || r.mime !== args.mime) throw new Error('receipt-conflict')
        return
      }
      tx.set(ref, { familyId: args.familyId, childId: args.childId, olympiadId: args.olympiadId, problemId: args.problemId,
        personId, status: 'stored', mime: args.mime, storage: { provider: 'yandex-disk', state: 'stored', path, sha256 } })
    })
  }
  // Registration revalidates the scope and ownership. A retry after interruption is safe.
  return registerOlympiadPhoto(db, args)
}

/** Binary response for an authenticated server endpoint; never return a Disk link. */
export async function readOlympiadPhoto(db, storage, args) {
  const c = context(db, { ...args, requestId: '_' })
  if (!id(args.photoId) || typeof storage?.getAt !== 'function' || typeof storage?.head !== 'function') throw new Error('invalid-photo')
  const checked = async tx => {
    const actor = await access(tx, db, c, args, ['student', 'parent'])
    const photo = (await tx.get(db.doc(`${c.base}/photos/${args.photoId}`))).data()
    const receipt = photo?.receiptId ? (await tx.get(db.doc(`olympiadPhotoReceipts/${photo.receiptId}`))).data() : null
    if (!photo || photo.problemId !== args.problemId || photo.status !== 'stored' || (actor.role === 'student' && photo.personId !== actor.personId)
      || !receipt || receipt.status !== 'stored' || receipt.personId !== photo.personId || receipt.familyId !== args.familyId || receipt.childId !== args.childId
      || receipt.olympiadId !== args.olympiadId || receipt.problemId !== args.problemId || receipt.storage?.path !== photo.storage?.path
      || receipt.storage?.sha256 !== photo.storage?.sha256 || !/^[a-f0-9]{64}$/.test(photo.storage?.sha256 ?? '')
      || !/^app:\/PETR\/Олимпиады\/[a-f0-9]{64}\/[a-f0-9]{64}\.(jpg|png|webp|heic|heif)$/.test(photo.storage?.path ?? '')
      || !photoFormats[receipt.mime]) throw new Error('photo-not-available')
    return { path: photo.storage.path, sha256: photo.storage.sha256, mime: receipt.mime }
  }
  const photo = await db.runTransaction(checked)
  const remote = await storage.head(photo.path)
  if (remote?.type !== 'file' || remote.public_url) throw new Error('photo-not-private')
  const bytes = await storage.getAt(photo.path)
  if (!Buffer.isBuffer(bytes) || bytes.length > 25_000_000 || createHash('sha256').update(bytes).digest('hex') !== photo.sha256 || !photoFormats[photo.mime].matches(bytes)) throw new Error('photo-integrity-failed')
  const current = await db.runTransaction(checked)
  if (current.path !== photo.path || current.sha256 !== photo.sha256 || current.mime !== photo.mime) throw new Error('photo-changed')
  return { bytes, mime: photo.mime }
}
