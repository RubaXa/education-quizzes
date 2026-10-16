#!/usr/bin/env node
/** @see ../docs/product/material-clarification.md */
import { hasSourceReceipt } from '../src/lib/materialRequest.ts'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Timestamp } from 'firebase-admin/firestore'
import { operatorFirestore } from './lib/admin-firebase.mjs'
import { dateWindow } from '../sync/project-plan.mjs'
import { enqueueSyncJob, setSyncJob, syncFingerprint, syncJobId } from '../sync/job-queue.mjs'
import { pendingManualQuestionIds, quizDecision } from '../assessment/decision-graph.mjs'
import { followupQueueSource } from '../assessment/quiz-lineage.mjs'

/** Scan live Firebase sources, persist operator work, and expose resumable phases.
 * The operator still performs source research and pedagogy; this command never
 * guesses an answer or marks a submission reviewed by itself.
 * @see ../docs/product/global-sync.md#operator-queue
 */
const db = operatorFirestore()
const started = performance.now()
const measurements = { phaseMs: {}, sourceDocuments: {}, sdkCalls: {} }
const queueProjectionFile = resolve('.local/project-sync/queue-projection.json')
const candidateCacheFile = resolve('.local/project-sync/candidate-fingerprints.json')
const command = process.argv[2] ?? 'scan'
if (!['scan', 'list', 'claim', 'advance', 'finish', 'block'].includes(command)) {
  throw new Error('Использование: npm run sync:queue -- scan|list|claim|advance|finish|block [--id ID] [--phase PHASE] [--evidence REF] [--reason CODE]')
}
function option(name) { const at = process.argv.indexOf(name); return at < 0 ? null : process.argv[at + 1] }
async function boundedMap(values, limit, visit) {
  const result = new Array(values.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++
      result[index] = await visit(values[index])
    }
  }))
  return result
}
function candidateCache() {
  try {
    const data = JSON.parse(readFileSync(candidateCacheFile, 'utf8'))
    if (data.version === 1 && data.fingerprints && typeof data.fingerprints === 'object'
      && !Array.isArray(data.fingerprints)) return data.fingerprints
  } catch { /* Missing or damaged local state requires a full server reconciliation. */ }
  return null
}
function saveCandidateCache(fingerprints) {
  mkdirSync(resolve('.local/project-sync'), { recursive: true })
  const temporary = `${candidateCacheFile}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify({ version: 1, fingerprints }), { mode: 0o600 })
  renameSync(temporary, candidateCacheFile)
}
function todayMoscow() { return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date()) }
function job(kind, familyId, childId, sourceId, source, revision, priority = 50) {
  return { kind, familyId, childId, sourceId, source, priority, fingerprint: syncFingerprint(revision) }
}
function inboxKind(item) {
  if (item.kind === 'textbook') return 'ingest-book'
  if (item.kind === 'textbook-pages') return 'publish-book-pages'
  if (item.kind === 'student-work') return item.lane === 'transfer' ? 'transfer-work' : item.lane === 'review' ? 'review-work' : 'investigate-work'
  if (item.kind === 'help-request') return 'triage-help'
  if (item.kind === 'quiz') return 'review-quiz'
  return `investigate-${item.kind}`.replace(/[^a-z0-9-]/g, '-').slice(0, 60)
}
function inboxSnapshot() {
  const output = execFileSync(process.execPath, [resolve('scripts/sync-inbox.mjs')], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const snapshot = JSON.parse(output)
  if (snapshot.complete !== true || !Array.isArray(snapshot.items)) throw new Error('Неполная очередь Firebase: новые работы не могут считаться отсутствующими.')
  return snapshot
}
async function discover() {
  const inboxStarted = performance.now()
  const inbox = inboxSnapshot()
  measurements.phaseMs.inbox = Math.round(performance.now() - inboxStarted)
  const candidates = inbox.items.map((item) => {
    const kind = inboxKind(item)
    const sourceId = `${item.dayDate ?? 'library'}:${item.id}`
    const source = { type: item.kind, id: item.id, dayDate: item.dayDate ?? null,
      taskId: item.taskId ?? null, lane: item.lane, status: item.status }
    return job(kind, item.familyId, item.childId, sourceId, source,
      [item.kind, item.status, item.createdAt, item.planRevision, item.sha256, item.requestedRevision, item.processingPhase],
      kind === 'review-work' ? 10 : kind === 'transfer-work' ? 20 : 50)
  })
  const windowDates = dateWindow(todayMoscow())
  const window = new Set(windowDates)
  const first = windowDates[0], last = windowDates.at(-1)
  const [owners, pages] = await Promise.all([
    db.collection('dayOwners').where('date', '>=', first).where('date', '<=', last).get(),
    db.collection('dayPages').where('targetDate', '>=', first).where('targetDate', '<=', last).get(),
  ])
  measurements.sourceDocuments.dayOwners = owners.size
  measurements.sourceDocuments.dayPages = pages.size
  measurements.sdkCalls.dayOwnerQueries = 1
  measurements.sdkCalls.dayPageQueries = 1
  const ownerByToken = new Map(owners.docs.map((doc) => [doc.id, doc.data()]))
  for (const doc of pages.docs) {
    const page = doc.data()
    if (page.kind !== 'student' || !window.has(page.targetDate)) continue
    const owner = ownerByToken.get(doc.id)
    if (!owner?.familyId || !owner?.childId) continue
    for (const subject of page.subjects ?? []) for (const task of subject.tasks ?? []) {
      if (task.instructionStatus?.state === 'needs-review') {
        candidates.push(job('enrich-task', owner.familyId, owner.childId,
          `${page.targetDate}:${task.id}`, { type: 'day-task', dayToken: doc.id, date: page.targetDate, taskId: task.id },
          [page.targetDate, task.id, task.meshText, task.instructionStatus, page.sourceRevision], 35))
      }
      if (task.materialStatus?.state === 'no-textbook' && /отсутств|не получен|нет в библиотек/i.test(task.materialStatus.message ?? '')) {
        candidates.push(job('material-needed', owner.familyId, owner.childId,
          `${page.targetDate}:${task.id}`, { type: 'day-task', dayToken: doc.id, date: page.targetDate, taskId: task.id },
          [page.targetDate, task.id, task.materialStatus.message, page.sourceRevision], 30))
      }
      const placement = (page.testPlacements ?? []).some((item) => item.taskId === task.id)
      const decision = quizDecision(task)
      if (decision && !task.testToken && !placement && task.platformResult?.state !== 'completed') {
        candidates.push(job(decision.job, owner.familyId, owner.childId,
          `${page.targetDate}:${task.id}`, { type: 'day-task', dayToken: doc.id, date: page.targetDate, taskId: task.id,
            assessmentMode: decision.mode ?? null, reason: decision.reason ?? null },
          [page.targetDate, task.id, task.meshText, task.assessmentIntent, page.sourceRevision], decision.job === 'classify-assignment' ? 32 : 40))
      }
    }
  }
  // Every submitted subject uses the same threshold. A passing test only
  // enters this queue after an explicit parent request on its assignment.
  // @see ../docs/product/assessment-decision-graph.md#followup-threshold
  const since = Timestamp.fromDate(new Date(`${first}T00:00:00+03:00`))
  const [recentQuizzes, parentRequests] = await Promise.all([
    db.collection('assignments').where('submittedAt', '>=', since).get(),
    db.collection('assignments').where('followupRequestedAt', '>=', since).get(),
  ])
  const historical = process.argv.includes('--full-audit')
    ? await db.collection('assignments').where('status', '==', 'submitted').get() : null
  const submittedQuizzes = new Map([...recentQuizzes.docs, ...parentRequests.docs, ...(historical?.docs ?? [])].map((doc) => [doc.id, doc]))
  measurements.sourceDocuments.recentQuizzes = recentQuizzes.size
  measurements.sourceDocuments.parentRequests = parentRequests.size
  measurements.sourceDocuments.historicalQuizzes = historical?.size ?? 0
  measurements.sdkCalls.quizSourceQueries = historical ? 3 : 2
  measurements.sdkCalls.followupLinkedQueries = 0
  measurements.sdkCalls.followupDetailGets = 0
  measurements.sourceDocuments.linkedAssignments = 0
  const followupStarted = performance.now()
  const followups = await boundedMap([...submittedQuizzes.values()], 4, async (doc) => {
    const assignment = doc.data()
    if (assignment.status !== 'submitted' || !assignment.familyId || !assignment.childId || !assignment.testId || !Array.isArray(assignment.questions)) return null
    measurements.sdkCalls.followupLinkedQueries++
    const linked = await db.collection('assignments').where('linkedToTestId', '==', assignment.testId).get()
    measurements.sourceDocuments.linkedAssignments += linked.size
    if (linked.docs.some((item) => item.data().familyId === assignment.familyId && item.data().childId === assignment.childId)) return null
    measurements.sdkCalls.followupDetailGets += 2
    const [answerKey, review] = await Promise.all([db.doc(`answerKeys/${doc.id}`).get(), db.doc(`reviews/${doc.id}`).get()])
    if (!answerKey.exists || pendingManualQuestionIds(assignment, review.data()).length) return null
    const source = followupQueueSource(assignment, answerKey.data(), review.data())
    if (!source) return null
    return job('prepare-targeted-followup', assignment.familyId, assignment.childId,
      assignment.testId, { ...source, id: doc.id },
      [assignment.testId, assignment.submittedAt?.toMillis?.(), review.updateTime?.toMillis?.(), assignment.followupRequestedAt?.toMillis?.()], 35)
  })
  candidates.push(...followups.filter(Boolean))
  measurements.phaseMs.followups = Math.round(performance.now() - followupStarted)
  // Reviewed uploads with no corresponding result are not in the ordinary
  // inbox. Detect the orphan rather than silently treating it as finished.
  measurements.sdkCalls.reviewedUploadQueries = 0
  measurements.sdkCalls.reviewedProgressQueries = 0
  measurements.sdkCalls.reviewedPageGets = 0
  measurements.sourceDocuments.reviewedUploads = 0
  measurements.sourceDocuments.reviewedProgress = 0
  const reviewedStarted = performance.now()
  const orphanGroups = await boundedMap(owners.docs, 4, async (ownerDoc) => {
    const owner = ownerDoc.data()
    if (!window.has(owner.date)) return []
    measurements.sdkCalls.reviewedUploadQueries++
    const files = await db.collection(`dayUploads/${ownerDoc.id}/files`).where('status', '==', 'reviewed').get()
    measurements.sourceDocuments.reviewedUploads += files.size
    const reviewed = files.docs.filter((file) => file.data().taskId && file.data().origin !== 'archive')
    if (!reviewed.length) return []
    measurements.sdkCalls.reviewedProgressQueries++
    const results = await db.collection(`dayProgress/${ownerDoc.id}/items`).get()
    measurements.sourceDocuments.reviewedProgress += results.size
    const byTask = new Map(results.docs.map((doc) => [doc.id, doc.data()]))
    measurements.sdkCalls.reviewedPageGets++
    const page = (await db.doc(`dayPages/${ownerDoc.id}`).get()).data()
    const pageTaskById = new Map((page?.subjects ?? []).flatMap((subject) => subject.tasks ?? []).map((task) => [task.id, task]))
    const missing = []
    for (const file of reviewed) {
      const data = file.data(), result = byTask.get(data.taskId)
      // A newer submission may supersede this attempt in dayProgress. The
      // upload's own reviewed status remains its durable historical result.
      if (result?.status || hasSourceReceipt(result) || pageTaskById.get(data.taskId)?.platformResult?.state === 'completed') continue
      missing.push(job('repair-review', owner.familyId, owner.childId,
        `${owner.date}:${file.id}`, { type: 'student-work', dayToken: ownerDoc.id, date: owner.date, uploadId: file.id, taskId: data.taskId },
        [file.id, data.taskId, data.reviewedAt?.toMillis?.()], 5))
    }
    return missing
  })
  candidates.push(...orphanGroups.flat())
  measurements.phaseMs.reviewedUploads = Math.round(performance.now() - reviewedStarted)
  return { inbox, candidates: [...new Map(candidates.map((candidate) =>
    [syncJobId(candidate.kind, candidate.familyId, candidate.childId, candidate.sourceId), candidate])).values()] }
}
async function verifiedResolution(record) {
  const source = record.source ?? {}
  if (record.kind === 'publish-book-pages') {
    const childPath = `families/${record.familyId}/children/${record.childId}`
    const binding = (await db.doc(`${childPath}/books/${source.id}`).get()).data()
    if (!binding || !['confirmed', 'provisional'].includes(binding.status)) return null
    const expected = binding.pdfPageCount
    if (!Number.isInteger(expected) || expected < 1 || !binding.pagesPublishedAt
      || binding.pagesPublishedSha256 !== (binding.catalogSha256 ?? binding.sourceSha256)) return null
    const pages = await db.collection(`${childPath}/bookPages`).where('bookId', '==', source.id).count().get()
    return pages.data().count === expected ? 'family-pages-fully-published' : null
  }
  if (record.kind === 'review-quiz') {
    const [assignment, review] = await Promise.all([
      db.doc(`assignments/${source.id}`).get(), db.doc(`reviews/${source.id}`).get(),
    ])
    return assignment.exists && !pendingManualQuestionIds(assignment.data(), review.data()).length
      ? 'all-open-answers-reviewed' : null
  }
  if (record.kind === 'prepare-control-followup') return 'superseded-by-universal-threshold-policy'
  if (record.kind === 'prepare-targeted-followup') {
    const linked = await db.collection('assignments').where('linkedToTestId', '==', source.testId).get()
    return linked.docs.some((item) => item.data().familyId === record.familyId && item.data().childId === record.childId)
      ? 'linked-targeted-followup-published' : null
  }
  if (['prepare-quiz', 'classify-assignment', 'enrich-task', 'material-needed'].includes(record.kind)) {
    const page = (await db.doc(`dayPages/${source.dayToken}`).get()).data()
    const task = page?.subjects?.flatMap((subject) => subject.tasks ?? []).find((item) => item.id === source.taskId)
    if (!task) return null
    return record.kind === 'classify-assignment' ? quizDecision(task)?.job === 'prepare-quiz' ? 'assessment-intent-confirmed' : null
      : record.kind === 'enrich-task' ? task.instructionStatus?.state === 'reviewed' ? 'reviewed-day-task' : null
      : record.kind === 'material-needed' ? task.materialStatus?.state === 'textbook-page-linked' ? 'family-material-linked' : null
      : task.testToken || (page.testPlacements ?? []).some((item) => item.taskId === source.taskId) ? 'linked-quiz-published' : null
  }
  if (['review-work', 'transfer-work', 'repair-review', 'investigate-work'].includes(record.kind)) {
    const owner = (await db.collection('dayOwners').where('date', '==', source.dayDate ?? source.date).get()).docs
      .find((item) => item.data().familyId === record.familyId && item.data().childId === record.childId)
    if (!owner) return null
    const upload = (await db.doc(`dayUploads/${owner.id}/files/${source.id ?? source.uploadId}`).get()).data()
    if (record.kind === 'transfer-work') return ['pending', 'reviewed'].includes(upload?.status) ? 'upload-transferred' : null
    const result = upload?.taskId ? (await db.doc(`dayProgress/${owner.id}/items/${upload.taskId}`).get()).data() : null
    const page = record.kind === 'repair-review' ? (await db.doc(`dayPages/${owner.id}`).get()).data() : null
    const platformDone = page?.subjects?.some((subject) => subject.tasks?.some((task) =>
      task.id === upload?.taskId && task.platformResult?.state === 'completed'))
    if (record.kind === 'repair-review') return upload?.origin === 'archive' || result?.status || hasSourceReceipt(result) || platformDone ? 'review-record-or-platform-result-present' : null
    return upload?.status === 'reviewed' && result?.uploadIds?.includes(source.id ?? source.uploadId) ? 'review-and-upload-published' : null
  }
  if (record.kind === 'ingest-book') {
    const books = await db.collection(`families/${record.familyId}/children/${record.childId}/bookUploads`).get()
    return books.docs.find((item) => item.id === source.id)?.data()?.status === 'linked' ? 'family-book-linked' : null
  }
  if (record.kind === 'triage-help') {
    const owner = (await db.collection('dayOwners').where('date', '==', source.dayDate).get()).docs
      .find((item) => item.data().familyId === record.familyId && item.data().childId === record.childId)
    if (!owner) return null
    const [request, result] = await Promise.all([
      db.doc(`dayHelp/${owner.id}/items/${source.id}`).get(),
      db.doc(`dayProgress/${owner.id}/items/${source.id}`).get(),
    ])
    return result.data()?.status === 'verified'
      && result.data()?.checkedAt?.toMillis?.() > request.data()?.requestedAt?.toMillis?.()
      ? 'later-student-work-verified' : null
  }
  return null
}
async function reportQueue(touched = [], snapshotOverride = null) {
  const snapshot = snapshotOverride ?? await db.collection('operatorSyncJobs')
    .where('status', 'in', ['queued', 'processing', 'blocked']).get()
  const active = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  const counts = Object.fromEntries(['queued', 'processing', 'blocked'].map((status) => [status, active.filter((item) => item.status === status).length]))
  const groups = new Map()
  for (const item of active) {
    const key = `${item.familyId}/${item.childId}`
    const group = groups.get(key) ?? { familyId: item.familyId, childId: item.childId, queued: 0, processing: 0, blocked: 0, byKind: {}, blockedReasons: {} }
    group[item.status]++
    group.byKind[item.kind] = (group.byKind[item.kind] ?? 0) + 1
    if (item.status === 'blocked' && item.reason) group.blockedReasons[item.reason] = (group.blockedReasons[item.reason] ?? 0) + 1
    groups.set(key, group)
  }
  for (const { familyId, childId } of touched) {
    const key = `${familyId}/${childId}`
    if (!groups.has(key)) groups.set(key, { familyId, childId, queued: 0, processing: 0, blocked: 0, byKind: {}, blockedReasons: {} })
  }
  if (touched.length) {
    const now = Timestamp.now()
    let published = {}
    try {
      const cached = JSON.parse(readFileSync(queueProjectionFile, 'utf8'))
      if (cached && typeof cached === 'object' && !Array.isArray(cached)) published = cached
    } catch { /* First run or a damaged local cache republishes safely. */ }
    const next = { ...published }
    const changed = [...new Set(touched.map(({ familyId, childId }) => `${familyId}/${childId}`))].filter((key) => {
      const group = groups.get(key)
      const fingerprint = syncFingerprint({ queued: group.queued, processing: group.processing,
        blocked: group.blocked, byKind: group.byKind, blockedReasons: group.blockedReasons })
      next[key] = fingerprint
      return published[key] !== fingerprint
    })
    let batch = db.batch(), pending = 0
    for (const key of changed) {
      const group = groups.get(key)
      batch.set(db.doc(`families/${group.familyId}/children/${group.childId}/syncStatus/current`),
        { queue: { queued: group.queued, processing: group.processing, blocked: group.blocked, byKind: group.byKind,
          blockedReasons: group.blockedReasons, updatedAt: now } }, { mergeFields: ['queue'] })
      if (++pending === 200) { await batch.commit(); batch = db.batch(); pending = 0 }
    }
    if (pending) await batch.commit()
    if (changed.length) {
      mkdirSync(resolve('.local/project-sync'), { recursive: true })
      const temporary = `${queueProjectionFile}.${process.pid}.tmp`
      writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 })
      renameSync(temporary, queueProjectionFile)
    }
  }
  return { counts, active: active.map((item) => ({ id: item.id, kind: item.kind, familyId: item.familyId,
    childId: item.childId, sourceId: item.sourceId, status: item.status, phase: item.phase, reason: item.reason })) }
}
if (command === 'scan') {
  const discoveryStarted = performance.now()
  const { inbox, candidates } = await discover()
  measurements.phaseMs.discovery = Math.round(performance.now() - discoveryStarted)
  const previousFingerprints = process.argv.includes('--full-audit') ? null : candidateCache()
  const nextFingerprints = {}
  const discovered = new Set()
  let created = 0, resolved = 0, unchanged = 0
  const enqueueStarted = performance.now()
  const candidatesWithIds = candidates.map((candidate) => ({ candidate,
    id: syncJobId(candidate.kind, candidate.familyId, candidate.childId, candidate.sourceId) }))
  const enqueueResults = await boundedMap(candidatesWithIds, 4, async ({ candidate, id }) => {
    // An unchanged source does not need another transaction just to rediscover
    // the same durable job. The cache is committed only after a complete scan.
    if (previousFingerprints?.[id] === candidate.fingerprint) return { id, candidate, unchanged: true, created: false }
    const result = await enqueueSyncJob(db, candidate)
    return { id, candidate, unchanged: false, created: result.created }
  })
  for (const { id, candidate, unchanged: same, created: isCreated } of enqueueResults) {
    if (same) unchanged++
    if (isCreated) created++
    nextFingerprints[id] = candidate.fingerprint
    discovered.add(id)
  }
  measurements.phaseMs.enqueue = Math.round(performance.now() - enqueueStarted)
  measurements.sdkCalls.enqueueTransactions = candidates.length - unchanged
  saveCandidateCache(nextFingerprints)
  const resolutionStarted = performance.now()
  const prior = await db.collection('operatorSyncJobs').where('status', 'in', ['queued', 'processing', 'blocked']).get()
  measurements.sourceDocuments.activeJobs = prior.size
  const touched = [...candidates, ...prior.docs.map((doc) => doc.data())].map(({ familyId, childId }) => ({ familyId, childId }))
  const resolutionResults = await boundedMap(prior.docs, 4, async (doc) => {
    const record = doc.data()
    if (record.status === 'done' || discovered.has(doc.id) || record.kind === 'reconcile-day') return false
    const evidence = await verifiedResolution(record)
    if (!evidence) return false
    await setSyncJob(db, doc.id, 'done', 'verified', { evidence })
    return true
  })
  resolved = resolutionResults.filter(Boolean).length
  measurements.phaseMs.resolve = Math.round(performance.now() - resolutionStarted)
  const projectionStarted = performance.now()
  const queue = await reportQueue(touched, resolved === 0 ? prior : null)
  measurements.phaseMs.projection = Math.round(performance.now() - projectionStarted)
  console.log(JSON.stringify({ scannedAt: new Date().toISOString(), inboxCounts: inbox.counts, inboxSnapshot: inbox,
    candidates: candidates.length, created, unchanged, fullAudit: previousFingerprints === null,
    resolved, ...queue, measurements: { ...measurements, inbox: inbox.measurements,
      totalMs: Math.round(performance.now() - started), note: 'SDK calls and returned documents, not billed reads' } }, null, 2))
} else if (command === 'list') {
  console.log(JSON.stringify(await reportQueue(), null, 2))
} else {
  const id = option('--id'), phase = option('--phase') ?? (command === 'claim' ? 'started' : command === 'finish' ? 'verified' : command === 'block' ? 'blocked' : null)
  if (!phase) throw new Error('Нужна --phase.')
  const status = command === 'finish' ? 'done' : command === 'block' ? 'blocked' : 'processing'
  const evidence = option('--evidence'), reason = option('--reason')
  if (status === 'blocked' && !/^[a-z][a-z0-9-]{2,80}$/.test(reason ?? '')) throw new Error('Для блокировки нужна причина.')
  const updated = await setSyncJob(db, id, status, phase, { evidence, reason })
  console.log(JSON.stringify({ updated: id, status, phase, ...await reportQueue([{ familyId: updated.familyId, childId: updated.childId }]) }, null, 2))
}
