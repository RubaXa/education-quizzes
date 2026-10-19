import { Timestamp } from '@google-cloud/firestore'
import { publishEducationEvent } from './event-queue.mjs'
import { createEducationEventId } from '../education-events/envelope.mjs'
import { pendingManualQuestionIds } from '../../assessment/decision-graph.mjs'
import { legacyHelpOperationId } from '../../sync/legacy-help-identity.mjs'

/** @see ../../docs/modules/synchronization/event-queue.md#обратная-совместимость @see ../../docs/services/telegram-bot/adapters/firestore.md#обратная-совместимость */

const DEFAULT_PAGE_SIZE = 25
const DEFAULT_INTERVAL_MS = 15_000
const CHECKPOINT = 'educationEventReconciliation/legacyActions'
const TYPES = Object.freeze(['help', 'quiz-submit', 'quiz-followup'])

/**
 * Bounded compatibility bridge for pre-queue PWA versions. It uses one page per
 * source on a timer, never a source listener, and seeds a durable watermark on
 * first install so historical work is not replayed as new activity.
 */
export function createLegacyEducationEventReconciler({ db, pageSize = DEFAULT_PAGE_SIZE, intervalMs = DEFAULT_INTERVAL_MS,
  clock = () => Date.now(), publish = publishEducationEvent, setTimer = setInterval, clearTimer = clearInterval,
  logger = () => {} }) {
  if (!db || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || intervalMs < 1_000) {
    throw new TypeError('Invalid legacy event reconciliation configuration.')
  }
  let timer = null
  let running = null
  let stopped = false

  async function watermark() {
    const ref = db.doc(CHECKPOINT)
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (snap.exists && snap.data()?.watermark) return snap.data().watermark
      // A bounded one-day lookback catches actions made just before a worker restart
      // without turning first install into a historical inbox backfill.
      const value = Timestamp.fromMillis(clock() - 24 * 60 * 60_000)
      tx.create(ref, { watermark: value, initializedAt: value, cursors: Object.fromEntries(TYPES.map((kind) => [kind, null])) })
      return value
    })
  }

  async function cursorFor(kind) { const snap = await db.doc(CHECKPOINT).get(); return snap.data()?.cursors?.[kind] ?? null }
  async function savePageState(kind, cursor, failedPaths) {
    const ref = db.doc(CHECKPOINT)
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) return
      const state = snap.data()
      tx.update(ref, {
        cursors: { ...(state.cursors ?? {}), [kind]: cursor },
        failedPaths: { ...(state.failedPaths ?? {}), [kind]: failedPaths.slice(0, pageSize) },
      })
    })
  }

  async function page(kind, query, processDocument) {
    const checkpoint = (await db.doc(CHECKPOINT).get()).data() ?? {}
    const after = await cursorFor(kind)
    const base = query.orderBy('__name__').limit(pageSize)
    let active = after?.timestamp && after?.path ? base.startAfter(Timestamp.fromMillis(after.timestamp), db.doc(after.path)) : base
    let snapshot = await active.get()
    if (!snapshot.docs.length && after) {
      active = base
      snapshot = await active.get()
    }
    const failedPaths = []
    const failedBefore = checkpoint.failedPaths?.[kind] ?? []
    for (const path of failedBefore) {
      if (stopped) break
      const retry = await db.doc(path).get()
      if (retry.exists && !(await processSafely(retry, processDocument))) failedPaths.push(path)
    }
    for (const doc of snapshot.docs) {
      if (stopped) break
      if (failedBefore.includes(doc.ref.path)) continue
      if (!(await processSafely(doc, processDocument))) failedPaths.push(doc.ref.path)
    }
    const last = snapshot.docs.at(-1)
    await savePageState(kind, last
      ? { timestamp: last.data()[cursorField(kind)]?.toMillis?.() ?? last.get(cursorField(kind))?.toMillis?.(), path: last.ref.path } : null, failedPaths)
    return snapshot.docs.length
  }

  async function processSafely(doc, processDocument) {
    try {
      await processDocument(doc)
      return true
    } catch (error) {
      logger({ code: 'legacy_event_item_retry', safeCode: error?.safeCode ?? 'event_publish_failed' })
      return false
    }
  }

  async function runOne() {
    if (stopped) return { help: 0, quizSubmit: 0, quizFollowup: 0 }
    if (running) return running
    running = (async () => {
      const since = await watermark()
      const timestamp = Timestamp.fromMillis(since.toMillis())
      const counts = { help: 0, quizSubmit: 0, quizFollowup: 0 }
      const helpQuery = db.collectionGroup('items').where('requestedAt', '>=', timestamp).orderBy('requestedAt')
      counts.help = await page('help', helpQuery, (doc) => reconcileHelp({ db, doc, publish }))
      const submittedQuery = db.collection('assignments').where('submittedAt', '>=', timestamp).orderBy('submittedAt')
      counts.quizSubmit = await page('quiz-submit', submittedQuery, (doc) => reconcileQuizSubmit({ db, doc, publish, since: timestamp }))
      const followupQuery = db.collection('assignments').where('followupRequestedAt', '>=', timestamp).orderBy('followupRequestedAt')
      counts.quizFollowup = await page('quiz-followup', followupQuery,
        (doc) => reconcileQuizFollowup({ db, doc, publish, since: timestamp }))
      return counts
    })().catch((error) => {
      logger({ code: 'legacy_event_reconciliation_failed', safeCode: error?.safeCode ?? 'reconciliation_failed' })
      throw error
    }).finally(() => { running = null })
    return running
  }

  return Object.freeze({ runOne,
    start() {
      if (timer || stopped) return
      void runOne().catch(() => {})
      timer = setTimer(() => { void runOne().catch(() => {}) }, intervalMs)
      timer?.unref?.()
    },
    async stop() {
      stopped = true
      if (timer) clearTimer(timer)
      timer = null
      await running?.catch(() => {})
    },
  })
}

async function reconcileHelp({ db, doc, publish }) {
  const path = doc.ref.path.split('/')
  if (path.length !== 4 || path[0] !== 'dayHelp' || path[2] !== 'items') return
  const [_, dayToken, , taskId] = path
  const help = doc.data()
  if (!Number.isInteger(help.revision) || !['condition', 'start', 'step', 'check'].includes(help.requestKind)
    || typeof help.requestText !== 'string' || !help.requestedAt?.toMillis) return
  const [ownerSnap, pageSnap, progressSnap] = await Promise.all([
    db.doc(`dayOwners/${dayToken}`).get(), db.doc(`dayPages/${dayToken}`).get(), db.doc(`dayProgress/${dayToken}/items/${taskId}`).get(),
  ])
  const owner = ownerSnap.data(), page = pageSnap.data(), progress = progressSnap.data()
  if (!ownerSnap.exists || !pageSnap.exists || page?.kind !== 'student' || !owner.familyId || !owner.childId
    || owner.familyId.length > 128 || owner.childId.length > 128
    || !page.subjects?.some((subject) => subject.tasks?.some((task) => task.id === taskId
      || task.problems?.some((problem) => problem.id === taskId)))) return
  if (progress?.status === 'verified' && progress.checkedAt?.toMillis?.() > help.requestedAt.toMillis()) return
  const guidance = await db.collection(`dayGuidance/${dayToken}/items`).where('taskId', '==', taskId)
    .where('createdAt', '>', help.requestedAt).limit(1).get()
  if (!guidance.empty) return
  if (await receiptMatches(db, help, 'help.requested', doc.ref.path, help.requestedAt)) return
  const legacyOperationId = legacyHelpOperationId({ dayToken, taskId, revision: help.revision, requestedAtMs: help.requestedAt.toMillis() })
  const operationId = help.eventReceiptId ? legacyOperationId
    : typeof help.eventOperationId === 'string' ? help.eventOperationId : legacyOperationId
  await publish(db, { eventType: 'help.requested', familyId: owner.familyId, childId: owner.childId, source: 'firestore',
    sourceRef: { kind: 'help', documentPath: doc.ref.path, dayToken, taskId }, operationId,
    actor: { type: 'system', id: 'server' }, createdAt: help.requestedAt })
}

async function reconcileQuizSubmit({ db, doc, publish }) {
  const assignment = doc.data()
  if (assignment.status !== 'submitted' || !assignment.familyId || !assignment.childId || !assignment.submittedAt) return
  if (await receiptMatches(db, assignment, 'quiz.submitted', doc.ref.path, assignment.submittedAt)) return
  const review = await db.doc(`reviews/${doc.id}`).get()
  const reviewData = review.data()
  if (reviewData && pendingManualQuestionIds(assignment, reviewData).length === 0) return
  const event = { eventType: 'quiz.submitted', familyId: assignment.familyId, childId: assignment.childId,
    source: 'firestore', sourceRef: { kind: 'quiz', documentPath: `assignments/${doc.id}`, quizToken: doc.id },
    operationId: assignment.eventOperationId || `quiz-submit:${doc.id}`, actor: { type: 'system', id: 'server' },
    createdAt: assignment.submittedAt }
  const id = await createEducationEventId(event)
  const jobId = createHash('sha256').update(JSON.stringify(['review-quiz', event.familyId, event.childId, id])).digest('hex')
  const job = await db.doc(`operatorSyncJobs/${jobId}`).get()
  if (job.data()?.status === 'done') return
  await publish(db, event)
}

async function reconcileQuizFollowup({ db, doc, publish }) {
  const assignment = doc.data()
  if (assignment.status !== 'submitted' || !assignment.familyId || !assignment.childId || !assignment.followupRequestedAt) return
  if (await receiptMatches(db, assignment, 'quiz.followup_requested', doc.ref.path, assignment.followupRequestedAt)) return
  const event = { eventType: 'quiz.followup_requested', familyId: assignment.familyId, childId: assignment.childId,
    source: 'firestore', sourceRef: { kind: 'quiz', documentPath: `assignments/${doc.id}`, quizToken: doc.id },
    operationId: `quiz-followup:${doc.id}`,
    actor: { type: 'system', id: 'server' }, createdAt: assignment.followupRequestedAt }
  const id = await createEducationEventId(event)
  const jobId = createHash('sha256').update(JSON.stringify(['generate-followup', event.familyId, event.childId, id])).digest('hex')
  const job = await db.doc(`operatorSyncJobs/${jobId}`).get()
  if (job.data()?.status === 'done') return
  const linked = await db.collection('assignments').where('linkedToTestId', '==', assignment.testId).limit(1).get()
  if (!linked.empty && linked.docs.some((candidate) => candidate.data().familyId === assignment.familyId
    && candidate.data().childId === assignment.childId)) return
  await publish(db, event)
}

async function receiptMatches(db, source, eventType, sourcePath, actionAt) {
  const eventId = source.eventReceiptId
  if (!/^[a-f0-9]{64}$/.test(eventId ?? '') || typeof source.eventOperationId !== 'string') return false
  const snapshot = await db.doc(`educationEvents/${eventId}`).get()
  const row = snapshot.data()
  return snapshot.exists && row?.eventId === eventId && row.eventType === eventType
    && row.operationId === source.eventOperationId && row.sourceRef?.documentPath === sourcePath
    && row.createdAt?.toMillis?.() === actionAt?.toMillis?.()
}
function cursorField(kind) { return kind === 'help' ? 'requestedAt' : kind === 'quiz-submit' ? 'submittedAt' : 'followupRequestedAt' }
