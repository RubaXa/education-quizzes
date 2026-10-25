/** @see ../docs/decisions/accepted-help-closure-2026-10-25.md */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { pendingManualQuestionIds } from '../assessment/decision-graph.mjs'
import { HelpRequestCache } from '../sync/help-request-cache.mjs'
import { helpRequestResolution } from '../sync/help-request-resolution.mjs'

/** Read-only operator inbox for the complete manual Education sync.
 * @see ../docs/modules/synchronization/education-pipeline.md#sync-inbox
 * @see ../docs/modules/materials/family-library.md#upload
 */
const localCredentials = resolve('.local', 'adc.json')
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) process.env.GOOGLE_APPLICATION_CREDENTIALS = localCredentials
if (!existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
  throw new Error('Для просмотра очередей нужен локальный .local/adc.json; отсутствие доступа не означает пустую очередь.')
}
initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
const db = getFirestore()
const helpCache = new HelpRequestCache(resolve('.local/project-sync/help-requests.json'), Timestamp)
const started = performance.now()
const timings = {}
const readCalls = { initialQueries: 4, pageCounts: 0, dayFiles: 0, dayHelp: 0,
  progressBatches: 0, progressRefs: 0, parentDecisionQueries: 0, manualReviews: 0 }

// Independent owners and books can be checked together without widening the
// source set. Keep a small limit to avoid a burst of Firestore requests.
async function boundedEach(values, limit, visit) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) await visit(values[next++])
  }))
}

function time(value) { return value?.toDate?.()?.toISOString?.() ?? null }

function classifyBook(status) {
  if (status === 'linked') return null
  if (['requested', 'awaiting-upload', 'uploaded'].includes(status)) return 'transfer'
  if (['stored', 'needs-identification'].includes(status)) return 'identify'
  return 'investigate'
}

function classifyWork(status) {
  if (['reviewed', 'deleted'].includes(status)) return null
  if (['requested', 'awaiting-upload', 'uploaded'].includes(status)) return 'transfer'
  if (status === 'pending') return 'review'
  return 'investigate'
}

async function readProgressBatch(studentToken, taskIds) {
  const byTask = new Map()
  const ids = [...new Set(taskIds.filter((id) => typeof id === 'string' && id))]
  for (let start = 0; start < ids.length; start += 250) {
    const refs = ids.slice(start, start + 250).map((id) => db.doc(`dayProgress/${studentToken}/items/${id}`))
    readCalls.progressBatches++
    readCalls.progressRefs += refs.length
    const snapshots = await db.getAll(...refs)
    for (const snapshot of snapshots) if (snapshot.exists) byTask.set(snapshot.id, snapshot.data())
  }
  return byTask
}

function addBook(items, snapshot) {
  for (const doc of snapshot.docs) {
    const child = doc.ref.parent.parent
    const family = child?.parent.parent
    if (!child || !family || family.parent.id !== 'families') {
      throw new Error(`Неизвестная семейная связь загрузки PDF: ${doc.ref.path}`)
    }
    const data = doc.data()
    const lane = classifyBook(data.status)
    if (!lane) continue
    items.push({ kind: 'textbook', lane, familyId: family.id, childId: child.id,
      id: doc.id, subjectKey: data.subjectKey ?? null, status: data.status ?? 'missing-status',
      sha256: data.sha256 ?? null, storageState: data.storage?.state ?? null,
      createdAt: time(data.createdAt), issuedAt: time(data.upload?.issuedAt),
      nextAction: lane === 'identify' ? 'verify-edition-index-and-link'
        : lane === 'investigate' ? 'inspect-upload-error-or-unknown-status'
          : data.status === 'uploaded' ? 'storage-worker-verify-file'
            : 'storage-worker-and-parent-browser-complete-transfer' })
  }
}

async function addBookPages(items, snapshot) {
  await boundedEach(snapshot.docs, 4, async (doc) => {
    const child = doc.ref.parent.parent
    const family = child?.parent.parent
    if (!child || !family || family.parent.id !== 'families') return
    const data = doc.data()
    if (!['confirmed', 'provisional'].includes(data.status)) return
    if (data.pagesPublishedAt && data.pagesPublishedSha256 === (data.catalogSha256 ?? data.sourceSha256)
      && Number.isInteger(data.pdfPageCount) && data.pdfPageCount > 0) return
    // The publication marker is written only after page-count verification.
    // Count the family pages again only when that marker is absent or stale.
    readCalls.pageCounts++
    const pages = await child.collection('bookPages').where('bookId', '==', doc.id).count().get()
    const availablePages = pages.data().count
    items.push({ kind: 'textbook-pages', lane: 'publish', familyId: family.id,
      childId: child.id, id: doc.id, status: 'pages-not-fully-published',
      expectedPages: data.pdfPageCount ?? null, availablePages,
      sourceSha256: data.sourceSha256 ?? null,
      nextAction: 'sync-books' })
  })
}

async function addDays(items, owners) {
  let scannedFiles = 0
  let scannedHelp = 0
  let fetchedHelp = 0
  const helpModes = { full: 0, delta: 0 }
  await boundedEach(owners.docs, 4, async (ownerDoc) => {
    const owner = ownerDoc.data()
    if (!owner.familyId || !owner.childId || !owner.date) {
      throw new Error(`У владельца дня ${ownerDoc.id} нет семейной связи или даты.`)
    }
    readCalls.dayFiles++
    readCalls.dayHelp++
    const [files, requests] = await Promise.all([
      db.collection(`dayUploads/${ownerDoc.id}/files`)
        .where('status', 'in', ['requested', 'awaiting-upload', 'uploaded', 'pending', 'upload-error']).get(),
      helpCache.read(ownerDoc.id, db.collection(`dayHelp/${ownerDoc.id}/items`)),
    ])
    // One task can appear in several photos and also in a help request.
    // Read each progress document once, in bounded getAll batches.
    const progress = await readProgressBatch(ownerDoc.id, [
      ...files.docs.filter((doc) => classifyWork(doc.data().status) === 'review').map((doc) => doc.data().taskId),
      ...requests.docs.map((doc) => doc.id),
    ])
    scannedFiles += files.size
    scannedHelp += requests.docs.length
    fetchedHelp += requests.fetched
    helpModes[requests.mode]++
    for (const doc of files.docs) {
      const data = doc.data()
      const lane = classifyWork(data.status)
      if (!lane) continue
      const processing = lane === 'review' && data.taskId
        ? progress.get(data.taskId)?.processing
        : null
      items.push({ kind: 'student-work', lane, familyId: owner.familyId,
        childId: owner.childId, dayDate: owner.date, id: doc.id,
        taskId: data.taskId ?? null, status: data.status ?? 'missing-status',
        planRevision: data.planRevision ?? null, storageState: data.storage?.state ?? null,
        processingPhase: processing?.phase ?? null, processingUpdatedAt: time(processing?.updatedAt),
        createdAt: time(data.createdAt), nextAction: lane === 'review' ? 'source-pack-and-review'
          : lane === 'investigate' ? 'inspect-upload-error-or-unknown-status'
            : 'storage-worker-and-student-browser-complete-transfer' })
    }
    // Read decisions freshly, independently of the cached immutable request.
    if (requests.docs.length) readCalls.parentDecisionQueries++
    const decisions = requests.docs.length ? (await db.collection(`dayParentDecisions/${ownerDoc.id}/events`).get())
      .docs.map(doc => ({ ...doc.data(), id: doc.id })) : []
    // A support revision alone is not proof of a reply. A later explicit family
    // acceptance closes attention for that same attempt without deleting history.
    for (const doc of requests.docs) {
      const data = doc.data()
      const later = progress.get(doc.id)
      if (helpRequestResolution({ taskId: doc.id, request: data, review: later, decisions })) continue
      items.push({ kind: 'help-request', lane: 'triage', familyId: owner.familyId,
        childId: owner.childId, dayDate: owner.date, id: doc.id,
        requestKind: data.requestKind ?? null, requestedRevision: data.revision ?? null,
        status: 'recorded-no-resolution-field', createdAt: time(data.requestedAt),
        nextAction: 'compare-request-with-support-and-response-history' })
    }
  })
  return { scannedFiles, scannedHelp, fetchedHelp, helpModes }
}

async function addSubmittedQuizzes(items, snapshot) {
  await boundedEach(snapshot.docs, 6, async (doc) => {
    const data = doc.data()
    const openQuestions = (data.questions ?? []).filter((question) => question.kind === 'long')
    if (!openQuestions.length) return // Other question types are graded from answerKeys.
    readCalls.manualReviews++
    const review = await db.doc(`reviews/${doc.id}`).get()
    const pendingQuestionIds = pendingManualQuestionIds(data, review.data())
    if (!pendingQuestionIds.length) return
    items.push({ kind: 'quiz', lane: 'review', familyId: data.familyId ?? null,
      childId: data.childId ?? null, id: doc.id, testId: data.testId ?? null,
      status: 'submitted-needs-manual-review', pendingQuestionIds, createdAt: time(data.submittedAt),
      nextAction: 'export-and-review-open-responses' })
  })
}

const initialStarted = performance.now()
const [books, boundBooks, owners, submitted] = await Promise.all([
  db.collectionGroup('bookUploads').get(),
  db.collectionGroup('books').get(),
  db.collection('dayOwners').get(),
  db.collection('assignments').where('status', '==', 'submitted').get(),
])
timings.initialMs = Math.round(performance.now() - initialStarted)
const items = []
addBook(items, books)
const pagesStarted = performance.now()
await addBookPages(items, boundBooks)
timings.bookPagesMs = Math.round(performance.now() - pagesStarted)
const daysStarted = performance.now()
const days = await addDays(items, owners)
timings.dayOwnersMs = Math.round(performance.now() - daysStarted)
const quizzesStarted = performance.now()
await addSubmittedQuizzes(items, submitted)
timings.submittedQuizzesMs = Math.round(performance.now() - quizzesStarted)
helpCache.retainOwners(owners.docs.map((doc) => doc.id))
helpCache.save()
items.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
  || a.kind.localeCompare(b.kind) || a.familyId?.localeCompare(b.familyId ?? '') || 0
  || a.childId?.localeCompare(b.childId ?? '') || 0 || a.id.localeCompare(b.id))
const counts = Object.fromEntries(['transfer', 'identify', 'publish', 'review', 'triage', 'investigate'].map((lane) => [lane,
  items.filter((item) => item.lane === lane).length]))
console.log(JSON.stringify({ complete: true, readOnly: true, checkedAt: new Date().toISOString(),
  measurements: { totalMs: Math.round(performance.now() - started), phaseMs: timings,
    firestoreCalls: readCalls, note: 'SDK calls and returned documents, not billed reads' },
  scanned: { bookUploads: books.size, boundBooks: boundBooks.size, dayOwners: owners.size, workUploads: days.scannedFiles,
    helpRequests: days.scannedHelp, helpDocumentsFetched: days.fetchedHelp, helpReadModes: days.helpModes,
    submittedQuizzes: submitted.size }, counts, items }, null, 2))
