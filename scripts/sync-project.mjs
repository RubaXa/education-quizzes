#!/usr/bin/env node
/**
 * @see ../docs/modules/synchronization/README.md
 * @see ../docs/modules/synchronization/global-sync.md#inventory
 * @see ../docs/operations/education-sync.md
 * @see ../docs/shared/server-runtime.md
 * @see ../docs/modules/school-diary/school-calendar.md
 * @see ../docs/decisions/pupil-vacations-2026-10-19.md
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Timestamp } from '@google-cloud/firestore'
import { operatorFirestore } from './lib/admin-firebase.mjs'
import { createTelemetryFromEnvironment, createRotatingJsonlSink } from '../packages/education-runtime/telemetry.mjs'
import { createFamilyGraphRepository } from '../packages/education-runtime/family-graph.mjs'
import { createLegacyMeshCredentialCodec } from '../packages/education-runtime/credentials.mjs'
import { createMeshSessionService } from '../packages/education-runtime/mesh-session.mjs'
import { syncDiary } from '../diary/application/sync.mjs'
import { ensureDataDir, readJson, writeJson } from '../diary/local-store.mjs'
import { collectedProjectSummary, dateWindow, mapBounded, projectTargets } from '../sync/project-plan.mjs'
import { persistMeshCapture } from '../sync/artifact-capture.mjs'
import { buildDayDashboardIndex } from '../day/dashboard-index.mjs'
import { assertGradeSnapshotAligned } from '../day/grade-reconciliation.mjs'
import { pendingPublicationDates, refreshedCalendarChecks } from '../sync/publication-audit.mjs'
import { enqueueSyncJob, setSyncJob, syncFingerprint } from '../sync/job-queue.mjs'
import { reuseRunContext } from '../sync/run-context.mjs'
import { calendarFailure, calendarShape, captureSchoolCalendar, normalizeSchoolCalendar } from '../sync/school-calendar.mjs'
import { publishSchoolCalendar } from '../sync/school-calendar-publication.mjs'

/** Global source collection. Enrichment and publication remain separate checked phases.
 * @see ../docs/modules/synchronization/global-sync.md#inventory
 * @see ../docs/modules/synchronization/global-sync.md#status
 */
const local = resolve('.local')
const telemetry = createTelemetryFromEnvironment({ sink: createRotatingJsonlSink(resolve(local, 'operator-runs', 'telemetry.jsonl')) })
const db = operatorFirestore({ telemetry })
const connections = resolve(local, 'mesh-connections')
const runDir = resolve(local, 'project-sync')
const legacyCodec = createLegacyMeshCredentialCodec({ familyAccessPath: resolve(local, 'family-access.json'),
  credentialsPath: resolve(local, 'diary', 'secret.json') })
const meshSessions = createMeshSessionService({ db, connectionsDir: connections, legacyCodec, telemetry })
const command = process.argv[2] || 'plan'
if (!['plan', 'collect', 'phase', 'calendar'].includes(command)) throw new Error('Использование: npm run sync:project -- plan | collect | calendar | phase --run ID --family ID --child ID --to PHASE')

// Timings are confined to the private run manifest. These count adapter
// operations, not underlying HTTP requests or billed Firestore document reads.
// @see ../docs/audits/education-sync-latency-audit-2026-10-15.md
const timingStart = Symbol('timingStart')
function newTiming() {
  return { clock: 'monotonic', startedAt: new Date().toISOString(), stages: {}, counts: {}, [timingStart]: performance.now() }
}
async function measure(timing, stage, work) {
  const started = performance.now()
  let failed = false
  try { return await telemetry.span(`sync.${stage}`, work, { consumer: 'operator' }) }
  catch (error) { failed = true; throw error }
  finally {
    const entry = timing.stages[stage] ?? { calls: 0, elapsedMs: 0, failures: 0 }
    const elapsedMs = Math.round((performance.now() - started) * 100) / 100
    entry.calls++
    entry.elapsedMs = Math.round((entry.elapsedMs + elapsedMs) * 100) / 100
    if (['syncDate', 'getProfile', 'getSchedule', 'getAssignments'].includes(stage)) {
      entry.samplesMs ??= []
      entry.samplesMs.push(elapsedMs)
    }
    if (failed) entry.failures++
    timing.stages[stage] = entry
  }
}
function count(timing, name, amount = 1) {
  timing.counts[name] = (timing.counts[name] ?? 0) + amount
  telemetry.count(`sync.${name}`, amount)
}
function finishTiming(timing) {
  if (timing.finishedAt) return timing
  timing.finishedAt = new Date().toISOString()
  timing.wallMs = Math.round((performance.now() - timing[timingStart]) * 100) / 100
  timing.trace = telemetry.snapshot()
  return timing
}

function moscowToday() {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date())
}
function safeReason(error) {
  const message = String(error?.message || '')
  if (/429|RATE_LIMITED/.test(message) || error?.code === 'RATE_LIMITED') return 'rate-limited'
  if (/AUTH_REQUIRED|ACCESS_NOT_VERIFIED|401|403/.test(message)
    || ['credentials_unavailable', 'credentials_mismatch', 'mesh_access_unverified', 'child_profile_unavailable'].includes(error?.code)) return 'auth-required'
  if (/INCOMPLETE_DETAIL/.test(message) || error?.code === 'mesh_incomplete') return 'incomplete-mesh'
  return 'source-error'
}
async function inventory(timing) {
  const graph = await measure(timing, 'familyGraph', () => createFamilyGraphRepository(db, { telemetry }).enumerate({
    includeInactiveFamilies: false, includeInactiveChildren: false }))
  const globalFailures = graph.failures.filter((failure) => !failure.familyId)
  if (globalFailures.length) throw new Error(`FAMILY_GRAPH_INCOMPLETE: ${globalFailures.map((failure) => failure.code).join(',')}`)
  const failedFamilies = new Set(graph.failures.map((failure) => failure.familyId).filter(Boolean))
  const families = graph.families.filter((family) => !failedFamilies.has(family.id))
  count(timing, 'inventoryDocumentsDelivered', graph.families.length + graph.children.length + graph.members.length
    + graph.accounts.length + graph.identities.length)
  const legacy = legacyCodec.describeOwner()
  const localAccounts = existsSync(connections) ? readdirSync(connections).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .map((name) => name.slice(0, -5)).filter((accountId) => meshSessions.credentials.hasCanonical(accountId)) : []
  const targets = projectTargets({ families, children: graph.children.filter((child) => !failedFamilies.has(child.familyId)),
    members: graph.members.filter((member) => !failedFamilies.has(member.familyId)),
    accounts: graph.accounts.filter((account) => !failedFamilies.has(account.familyId)),
    identities: graph.identities.filter((identity) => !failedFamilies.has(identity.familyId)), localAccounts, legacy })
  return { families, accounts: graph.accounts.filter((account) => !failedFamilies.has(account.familyId)).length, targets,
    inventoryFailures: graph.failures.map(({ familyId, source, code }) => ({ ...(familyId ? { familyId } : {}), ...(source ? { source } : {}), code })) }
}
function publicSummary(data) {
  const reasons = {}
  for (const item of data.targets.filter((target) => target.state === 'blocked')) reasons[item.reason] = (reasons[item.reason] || 0) + 1
  return { families: data.families.length, children: data.targets.length, sourceAccounts: data.accounts,
    queued: data.targets.filter((target) => target.state === 'queued').length, blocked: reasons,
    inventoryFailures: data.inventoryFailures.length }
}
function statusRef(target) {
  return db.doc(`families/${target.familyId}/children/${target.childId}/syncStatus/current`)
}
function sourceDirectory(target) {
  return target.credentialKind === 'legacy' ? resolve(local, 'diary')
    : resolve(runDir, 'sources', target.familyId, target.childId, 'diary')
}
async function collectChildCalendar(target, adapter, today, timing, publish = false) {
  const dir = sourceDirectory(target)
  const owner = { source: 'mesh', familyId: target.familyId, childId: target.childId,
    sourceAccountId: target.sourceAccountId, sourcePersonId: target.sourcePersonId }
  if (target.credentialKind !== 'legacy') writeJson(dirname(dir), 'context.json', owner)
  const capture = { ...await measure(timing, 'getSchoolCalendar', () => captureSchoolCalendar(adapter, today,
    () => new Date().toISOString(), failure => writeJson(dir, 'school-calendar-failure.json', failure))), owner }
  writeJson(dir, 'school-calendar-attempt.json', capture)
  const calendar = normalizeSchoolCalendar(capture, owner)
  writeJson(dir, 'school-calendar-capture.json', capture)
  writeJson(dir, 'school-calendar.json', calendar)
  const tokens = readJson(dirname(dir), 'day-dashboard-links.json')
  if (publish && (!tokens?.student || !tokens?.parent)) throw Error('calendar_dashboards_required')
  const publication = publish && tokens?.student && tokens?.parent
    ? await measure(timing, 'publishSchoolCalendar', () => publishSchoolCalendar({ db, tokens, owner, calendar, today })) : null
  return { state: publication ? 'complete' : 'captured', query: capture.query, shape: calendarShape(capture.payload),
    checkedAt: calendar.checkedAt, vacations: calendar.vacations, publication }
}
async function status(target, runId, phase, extra = {}) {
  await statusRef(target).set({ runId, phase, updatedAt: Timestamp.now(), ...extra }, { merge: true })
}
async function auditPublishedDays(dir, dates, asOf, timing) {
  const workspace = dirname(dir)
  const links = readJson(workspace, 'day-links.json') ?? {}
  const dashboardTokens = readJson(workspace, 'day-dashboard-links.json') ?? {}
  const pendingByDate = new Map()
  const freshness = []
  for (const role of ['student', 'parent']) {
    const expected = buildDayDashboardIndex(workspace, links, role)
    const token = dashboardTokens[role]
    const snapshot = token ? await measure(timing, 'publishedDashboardRead', () => db.doc(`dayDashboards/${token}`).get()) : null
    const published = snapshot?.data() ?? null
    if (published && published.kind === role && published.familyId && published.childId) {
      const days = refreshedCalendarChecks(expected, published)
      if (days) freshness.push({ role, snapshot, days })
    }
    for (const item of pendingPublicationDates(expected, published, dates)) {
      const reasons = pendingByDate.get(item.date) ?? new Set()
      for (const reason of item.reasons) reasons.add(`${role}:${reason}`)
      pendingByDate.set(item.date, reasons)
    }
  }
  // The dashboard reads grades from the most recent day page, not from the
  // calendar index. A zero calendar diff cannot certify that the marks shown
  // to either role caught up with the complete MESH period snapshot.
  const currentSourceDate = Object.keys(links).filter((item) => item <= asOf).sort().at(-1)
  const latestMesh = readJson(dir, `snapshot-${dates.at(-1)}.json`)
  if (currentSourceDate && latestMesh?.complete && Array.isArray(latestMesh.marks)) {
    for (const role of ['student', 'parent']) {
      const token = links[currentSourceDate]?.[role]
      const page = token ? (await measure(timing, 'publishedGradePageRead', () => db.doc(`dayPages/${token}`).get())).data() : null
      try { assertGradeSnapshotAligned({ subjects: page?.grades ?? [] }, latestMesh) }
      catch {
        const targetDate = page?.targetDate ?? currentSourceDate
        const reasons = pendingByDate.get(targetDate) ?? new Set()
        reasons.add(`${role}:grade-projection-stale`)
        pendingByDate.set(targetDate, reasons)
      }
    }
  }
  return { pending: [...pendingByDate].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, reasons]) => ({ date, reasons: [...reasons].sort() })), freshness }
}
async function publishCalendarChecks(target, candidates, timing) {
  const owned = candidates.filter(({ snapshot }) => snapshot.data().familyId === target.familyId
    && snapshot.data().childId === target.childId)
  if (owned.length !== candidates.length) throw new Error('Календарь принадлежит другой семье или ребёнку.')
  if (!owned.length) return 0
  const batch = db.batch()
  for (const { snapshot, days } of owned) batch.update(snapshot.ref, { days, updatedAt: Timestamp.now() },
    { lastUpdateTime: snapshot.updateTime })
  await measure(timing, 'calendarCommit', () => batch.commit())
  for (const { snapshot, days } of owned) {
    const live = (await measure(timing, 'calendarReadback', () => snapshot.ref.get())).data()
    if (JSON.stringify(live?.days) !== JSON.stringify(days)) throw new Error('Время проверки календаря не подтвердилось после публикации.')
  }
  return new Set(owned.flatMap(({ snapshot, days }) => days.filter((day, index) =>
    day.checkedAt !== snapshot.data().days[index]?.checkedAt).map((day) => day.date))).size
}
async function collectChild(target, adapter, runId, today, timing) {
  const dates = dateWindow(today)
  count(timing, 'datesPlanned', dates.length)
  await measure(timing, 'statusWrite', () => status(target, runId, 'fetching', { checkedDates: 0, currentDate: null, totalDates: dates.length, reason: null }))
  for (const method of ['getProfile', 'getMarks', 'getSchedule', 'getAssignments', 'getLessonDetails']) {
    const original = adapter[method].bind(adapter)
    adapter[method] = (...args) => measure(timing, method, () => original(...args))
  }
  reuseRunContext(adapter, (method) => count(timing, `${method}Reused`), telemetry)
  const dir = sourceDirectory(target)
  if (target.credentialKind !== 'legacy') writeJson(dirname(dir), 'context.json', {
    familyId: target.familyId, childId: target.childId,
    sourceAccountId: target.sourceAccountId, sourcePersonId: target.sourcePersonId,
  })
  // One source request per pupil/run, independent of the 42 daily schedule reads.
  // A calendar outage must not prevent checking newly submitted homework.
  let schoolCalendar
  try { schoolCalendar = await collectChildCalendar(target, adapter, today, timing, true) }
  catch (error) { schoolCalendar = { state: 'blocked', diagnostic: calendarFailure(error) } }
  const changes = { lessons: 0, grades: 0, assignments: 0 }
  const changedGradeKeys = new Set()
  const changedDates = []
  let checked = 0, lastFull = null, captures = 0
  for (let index = 0; index < dates.length; index++) {
    const date = dates[index]
    const result = await measure(timing, 'syncDate', () => syncDiary({ adapter, dataDir: dir, date }))
    count(timing, 'datesAttempted')
    if (!result.complete) {
      const reason = Object.values(result.errors).includes('RATE_LIMITED') ? 'rate-limited'
        : Object.values(result.errors).includes('AUTH_REQUIRED') ? 'auth-required' : 'incomplete-mesh'
      await measure(timing, 'statusWrite', () => status(target, runId, 'blocked', { reason, checkedDates: checked, currentDate: date, lastFullMeshAt: lastFull }))
      return { state: 'blocked', reason, checkedDates: checked, lastFullMeshAt: lastFull, changes, schoolCalendar }
    }
    await measure(timing, 'persistCapture', () => persistMeshCapture({ runDir, runId, familyId: target.familyId, childId: target.childId, snapshot: result }))
    captures++
    checked++
    count(timing, 'datesComplete')
    lastFull = result.fetchedAt
    const dayChanges = {}
    for (const [section, label] of [['schedule', 'lessons'], ['marks', 'grades'], ['assignments', 'assignments']]) {
      const diff = result.changesSincePrevious?.sections?.[section]
      if (diff?.comparable) {
        const count = diff.added.length + diff.removed.length + diff.changed.length
        if (label === 'grades') {
          for (const key of [...diff.added, ...diff.removed, ...diff.changed]) changedGradeKeys.add(key)
          changes.grades = changedGradeKeys.size
        } else changes[label] += count
        // Marks are a period-wide snapshot repeated for every requested date;
        // only lesson and assignment changes identify a particular school day.
        if (count && label !== 'grades') dayChanges[label] = count
      }
    }
    if (Object.keys(dayChanges).length) changedDates.push({ date, changes: dayChanges, fetchedAt: result.fetchedAt })
    if (checked % 4 === 0 || checked === dates.length) {
      await measure(timing, 'statusWrite', () => status(target, runId, 'fetching', { checkedDates: checked, totalDates: dates.length, currentDate: date, lastFullMeshAt: lastFull }))
    }
  }
  const publication = await measure(timing, 'publicationAudit', () => auditPublishedDays(dir, dates, today, timing))
  const pendingPublicationDatesByDay = publication.pending
  const calendarChecksPublished = await measure(timing, 'calendarCheckUpdate', () => publishCalendarChecks(target, publication.freshness, timing))
  count(timing, 'datesWithSourceChanges', changedDates.length)
  count(timing, 'datesPendingPublication', pendingPublicationDatesByDay.length)
  count(timing, 'calendarChecksPublished', calendarChecksPublished)
  const expected = buildDayDashboardIndex(dirname(dir), readJson(dirname(dir), 'day-links.json') ?? {}, 'student')
  const expectedByDate = new Map((expected.days ?? []).map((day) => [day.date, day]))
  for (const date of new Set([...changedDates.map((item) => item.date), ...pendingPublicationDatesByDay.map((item) => item.date)])) {
    const revision = expectedByDate.get(date)?.sourceRevision
    await measure(timing, 'enqueueDay', () => enqueueSyncJob(db, { kind: 'reconcile-day', familyId: target.familyId, childId: target.childId,
      sourceId: date, source: { type: 'mesh-day', date }, runId, priority: 25,
      fingerprint: syncFingerprint([date, revision ?? null]) }))
  }
  if (Object.values(changes).every((count) => count === 0) && pendingPublicationDatesByDay.length === 0) {
    await measure(timing, 'statusWrite', () => status(target, runId, 'complete', { checkedDates: checked, totalDates: dates.length,
      currentDate: dates.at(-1), lastFullMeshAt: lastFull, pendingPublicationCount: 0,
      reason: null, verifiedAt: Timestamp.now() }))
    return { state: 'complete', checkedDates: checked, privateCaptures: captures, calendarChecksPublished, schoolCalendar,
      checkedFrom: dates[0], checkedThrough: dates.at(-1), lastFullMeshAt: lastFull,
      changes, changedDates, pendingPublicationDates: pendingPublicationDatesByDay, sourceDir: dir }
  }
  await measure(timing, 'statusWrite', () => status(target, runId, 'awaiting-review', { checkedDates: checked, totalDates: dates.length,
    currentDate: dates.at(-1), lastFullMeshAt: lastFull,
    pendingPublicationCount: pendingPublicationDatesByDay.length, reason: 'source-review-required' }))
  return { state: 'awaiting-enrichment', checkedDates: checked, privateCaptures: captures, calendarChecksPublished, schoolCalendar,
    checkedFrom: dates[0], checkedThrough: dates.at(-1), lastFullMeshAt: lastFull,
    changes, changedDates, pendingPublicationDates: pendingPublicationDatesByDay, sourceDir: dir }
}
async function collectAccount(accountId, targets, runId, today) {
  const timing = newTiming()
  try {
    const results = []
    for (const target of targets) {
      const childTiming = newTiming()
      try {
        const scope = { source: 'mesh', familyId: target.familyId, childId: target.childId,
          sourceAccountId: accountId, sourcePersonId: target.sourcePersonId }
        const legacyOwner = target.credentialKind === 'legacy'
          ? { kind: 'legacy', familyId: target.familyId, childId: target.childId, accountId } : null
        const result = await measure(timing, 'childCollection', () => meshSessions.withChildAdapter(scope,
          (adapter) => collectChild(target, adapter, runId, today, childTiming), { legacyOwner }))
        results.push({ target, result: { ...result, timing: finishTiming(childTiming) } })
        if (result.reason === 'rate-limited' || result.reason === 'auth-required') {
          for (const remaining of targets.slice(results.length)) {
            await measure(timing, 'statusWriteSkippedChild', () => status(remaining, runId, 'blocked', { reason: result.reason }))
            results.push({ target: remaining, result: { state: 'blocked', reason: result.reason } })
          }
          break
        }
      }
      catch (error) {
        const reason = safeReason(error)
        await measure(childTiming, 'statusWrite', () => status(target, runId, 'blocked', { reason }))
        results.push({ target, result: { state: 'blocked', reason, timing: finishTiming(childTiming) } })
        if (reason === 'rate-limited' || reason === 'auth-required') {
          for (const remaining of targets.slice(results.length)) {
            await measure(timing, 'statusWriteSkippedChild', () => status(remaining, runId, 'blocked', { reason }))
            results.push({ target: remaining, result: { state: 'blocked', reason } })
          }
          break
        }
      }
    }
    return { results, timing: finishTiming(timing) }
  } catch (error) {
    if (error && typeof error === 'object') error.syncTiming = finishTiming(timing)
    throw error
  }
}

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}
async function markPhase() {
  const runId = option('--run'), familyId = option('--family'), childId = option('--child'), phase = option('--to')
  if (!/^\d{4}-\d{2}-\d{2}-[a-f0-9-]{36}$/.test(runId ?? '')
    || !/^[A-Za-z0-9_-]{1,120}$/.test(familyId ?? '') || !/^[A-Za-z0-9_-]{1,120}$/.test(childId ?? '')
    || !['enriching', 'publishing', 'verifying', 'complete', 'blocked'].includes(phase)) throw new Error('Нужны существующий runId, семья, ребёнок и допустимая фаза.')
  const manifest = readJson(runDir, `run-${runId}.json`)
  const job = manifest?.jobs?.find((item) => item.familyId === familyId && item.childId === childId)
  if (!job) throw new Error('Ребёнка нет в журнале этого запуска.')
  const target = { familyId, childId }
  const current = (await statusRef(target).get()).data()
  if (current?.runId !== runId) throw new Error('Адресный статус относится к другому запуску.')
  const transitions = {
    'awaiting-review': ['enriching', 'blocked'], enriching: ['publishing', 'blocked'],
    publishing: ['verifying', 'blocked'], verifying: ['complete', 'blocked'],
    blocked: ['enriching'],
  }
  const noSourceChanges = job.changes && Object.values(job.changes).every((count) => count === 0)
    && (job.pendingPublicationDates ?? []).length === 0
  const noChangeCompletion = current.phase === 'awaiting-review' && phase === 'complete' && noSourceChanges
  if (current.phase !== phase && !transitions[current.phase]?.includes(phase) && !noChangeCompletion) throw new Error('Нарушен порядок фаз синхронизации.')
  if (phase === 'complete' && (!process.argv.includes('--readback-verified') || !process.argv.includes('--final-inbox-checked'))) {
    throw new Error('Для complete нужны подтверждённое чтение ролевых документов и конечная очередь.')
  }
  if (phase === 'complete') {
    if (!job.sourceDir || !job.checkedFrom || !job.checkedThrough) throw new Error('Нет полного проверенного окна МЭШ для завершения запуска.')
    const dates = dateWindow(manifest.startedFor)
    if (dates[0] !== job.checkedFrom || dates.at(-1) !== job.checkedThrough) throw new Error('Окно МЭШ в журнале не совпадает с текущим протоколом.')
    const { pending } = await auditPublishedDays(job.sourceDir, dates, manifest.startedFor, newTiming())
    if (pending.length) throw new Error(`Остались неопубликованные дни: ${pending.map((item) => item.date).join(', ')}.`)
    const queued = (await db.collection('operatorSyncJobs').where('runId', '==', runId).get()).docs.filter((doc) => {
      const item = doc.data()
      return item.kind === 'reconcile-day' && item.runId === runId && item.familyId === familyId
        && item.childId === childId && item.status !== 'done'
    })
    for (const item of queued) await setSyncJob(db, item.id, 'done', 'readback-verified', { evidence: 'both-role-dashboard-index-and-day-readback' })
  }
  const reason = phase === 'blocked' ? option('--reason') : null
  if (phase === 'blocked' && !/^[a-z][a-z0-9-]{2,80}$/.test(reason ?? '')) throw new Error('Для остановки нужна краткая причина.')
  await status(target, runId, phase, { reason, ...(phase === 'complete' ? { verifiedAt: Timestamp.now() } : {}) })
  writeJson(runDir, `phase-${runId}-${familyId}-${childId}.json`, { runId, familyId, childId, phase, reason, recordedAt: new Date().toISOString() })
  console.log(JSON.stringify({ phase, recorded: true }))
}

if (command === 'phase') await markPhase()
else {
const runTiming = newTiming()
const data = await measure(runTiming, 'inventory', () => inventory(runTiming))
if (command === 'calendar') {
  const results = []
  for (const target of data.targets) {
    if (target.state !== 'queued') { results.push({ state: 'blocked', reason: target.reason }); continue }
    try {
      const scope = { source: 'mesh', familyId: target.familyId, childId: target.childId,
        sourceAccountId: target.sourceAccountId, sourcePersonId: target.sourcePersonId }
      const legacyOwner = target.credentialKind === 'legacy'
        ? { kind: 'legacy', familyId: target.familyId, childId: target.childId, accountId: target.sourceAccountId } : null
      const result = await meshSessions.withChildAdapter(scope, adapter => collectChildCalendar(target, adapter, moscowToday(),
        runTiming, process.argv.includes('--publish')), { legacyOwner })
      results.push(result)
    } catch (error) { results.push({ state: 'blocked', reason: safeReason(error), diagnostic: calendarFailure(error) }) }
  }
  console.log(JSON.stringify({ ...publicSummary(data), calendar: results, readOnly: !process.argv.includes('--publish'), measurements: finishTiming(runTiming) }, null, 2))
  if (results.some(result => result.state === 'blocked')) process.exitCode = 2
} else if (command === 'plan') {
  const timing = finishTiming(runTiming)
  console.log(JSON.stringify({ readOnly: true, ...publicSummary(data),
    measurements: { totalMs: timing.wallMs, inventoryMs: timing.stages.inventory?.elapsedMs ?? null,
      counts: timing.counts, note: 'SDK calls and returned documents, not billed reads' } }, null, 2))
} else {
  ensureDataDir(runDir)
  const lock = resolve(runDir, 'active.lock')
  try { writeFileSync(lock, `${process.pid}\n`, { mode: 0o600, flag: 'wx' }) }
  catch { throw new Error('Глобальный сбор уже запущен или остался lock после сбоя; сначала проверьте журнал.') }
  const runId = `${moscowToday()}-${randomUUID()}`
  const today = moscowToday()
  const results = []
  try {
    await measure(runTiming, 'openingStatuses', async () => {
      let openingBatch = db.batch(), openingCount = 0
      for (const target of data.targets) {
        if (target.state === 'blocked') {
          openingBatch.set(statusRef(target), { runId, phase: 'blocked', updatedAt: Timestamp.now(), reason: target.reason }, { merge: true })
          results.push({ target, result: { state: 'blocked', reason: target.reason } })
        } else openingBatch.set(statusRef(target), { runId, phase: 'queued', updatedAt: Timestamp.now(), reason: null, checkedDates: 0 }, { merge: true })
        if (++openingCount === 200) { await openingBatch.commit(); openingBatch = db.batch(); openingCount = 0 }
      }
      if (openingCount) await openingBatch.commit()
    })
    count(runTiming, 'childrenDiscovered', data.targets.length)
    const groups = Map.groupBy(data.targets.filter((item) => item.state === 'queued'), (item) => item.sourceAccountId)
    count(runTiming, 'accountsQueued', groups.size)
    const completed = await measure(runTiming, 'accountCollection', () => mapBounded([...groups], 2,
      async ([accountId, targets]) => collectAccount(accountId, targets, runId, today)))
    const accountTimings = []
    for (let index = 0; index < completed.length; index++) {
      const entry = completed[index]
      accountTimings.push(entry.status === 'fulfilled' ? entry.value.timing : entry.reason?.syncTiming ?? null)
      if (entry.status === 'fulfilled') results.push(...entry.value.results)
      else for (const target of [...groups][index][1]) {
        const reason = safeReason(entry.reason)
        await status(target, runId, 'blocked', { reason })
        results.push({ target, result: { state: 'blocked', reason } })
      }
    }
    runTiming.accounts = accountTimings
    finishTiming(runTiming)
    const manifest = { runId, startedFor: today, finishedAt: new Date().toISOString(),
      inventory: publicSummary(data), timing: runTiming, jobs: results.map(({ target, result }) => ({
        familyId: target.familyId, childId: target.childId, sourceAccountId: target.sourceAccountId ?? null, ...result,
      })) }
    writeJson(runDir, `run-${runId}.json`, manifest)
    const blocked = results.filter((item) => item.result.state === 'blocked').length
    const calendarsBlocked = results.filter((item) => item.result.schoolCalendar?.state === 'blocked').length
    console.log(JSON.stringify({ runId, families: data.families.length, children: data.targets.length,
      fetched: results.length - blocked, blocked, calendarsBlocked,
      report: collectedProjectSummary(manifest), timing: runTiming,
      changedDates: results.reduce((sum, item) => sum + (item.result.changedDates?.length ?? 0), 0),
      pendingPublicationDates: results.reduce((sum, item) => sum + (item.result.pendingPublicationDates?.length ?? 0), 0),
      state: blocked === results.length ? 'blocked' : blocked || calendarsBlocked ? 'partially-collected'
        : results.every((item) => item.result.state === 'complete') ? 'complete' : 'awaiting-enrichment-and-publication',
      journal: `project-sync/run-${runId}.json` }, null, 2))
    if (blocked || calendarsBlocked) process.exitCode = 2
  } finally { rmSync(lock, { force: true }) }
}
}
