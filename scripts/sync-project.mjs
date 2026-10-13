#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { Timestamp } from 'firebase-admin/firestore'
import { operatorFirestore } from './lib/admin-firebase.mjs'
import { MeshDiaryAdapter } from '../packages/education-connect/lib/mesh.mjs'
import { syncDiary } from '../diary/application/sync.mjs'
import { ensureDataDir, readJson, writeJson } from '../diary/local-store.mjs'
import { dateWindow, mapBounded, projectTargets } from '../sync/project-plan.mjs'
import { persistMeshCapture } from '../sync/artifact-capture.mjs'
import { buildDayDashboardIndex } from '../day/dashboard-index.mjs'
import { pendingPublicationDates } from '../sync/publication-audit.mjs'
import { enqueueSyncJob, setSyncJob, syncFingerprint } from '../sync/job-queue.mjs'

/** Global source collection. Enrichment and publication remain separate checked phases.
 * @see ../docs/product/global-sync.md#inventory
 * @see ../docs/product/global-sync.md#status
 */
const db = operatorFirestore()
const local = resolve('.local')
const connections = resolve(local, 'mesh-connections')
const runDir = resolve(local, 'project-sync')
const command = process.argv[2] || 'plan'
if (!['plan', 'collect', 'phase'].includes(command)) throw new Error('Использование: npm run sync:project -- plan | collect | phase --run ID --family ID --child ID --to PHASE')

function json(file) { return JSON.parse(readFileSync(file, 'utf8')) }
function sourceKey(value) { return createHash('sha256').update(`mesh-parent:${value}`).digest('hex') }
function moscowToday() {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date())
}
function safeReason(error) {
  const message = String(error?.message || '')
  if (/429|RATE_LIMITED/.test(message)) return 'rate-limited'
  if (/AUTH_REQUIRED|ACCESS_NOT_VERIFIED|401|403/.test(message)) return 'auth-required'
  if (/INCOMPLETE_DETAIL/.test(message)) return 'incomplete-mesh'
  return 'source-error'
}
async function inventory() {
  const [familyDocs, accountDocs, identityDocs] = await Promise.all([
    db.collection('families').get(), db.collection('sourceAccounts').get(), db.collection('sourceIdentities').get(),
  ])
  const families = familyDocs.docs.map((doc) => ({ id: doc.id }))
  const nested = await Promise.all(families.map(async (family) => {
    const [children, members] = await Promise.all([
      db.collection(`families/${family.id}/children`).get(), db.collection(`families/${family.id}/members`).get(),
    ])
    return {
      children: children.docs.map((doc) => ({ ...doc.data(), id: doc.id, familyId: family.id })),
      members: members.docs.map((doc) => ({ ...doc.data(), id: doc.id, familyId: family.id })),
    }
  }))
  const access = readJson(local, 'family-access.json')
  const oldSecret = readJson(resolve(local, 'diary'), 'secret.json')
  const legacy = access?.legacyDayOwner && oldSecret?.actorPersonId
    ? { ...access.legacyDayOwner, accountId: sourceKey(oldSecret.actorPersonId) } : null
  const localAccounts = existsSync(connections) ? readdirSync(connections).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).map((name) => name.slice(0, -5)) : []
  const targets = projectTargets({ families,
    children: nested.flatMap((item) => item.children),
    members: nested.flatMap((item) => item.members),
    accounts: accountDocs.docs.map((doc) => ({ ...doc.data(), id: doc.id })),
    identities: identityDocs.docs.map((doc) => ({ ...doc.data(), id: doc.id })), localAccounts, legacy })
  return { families, accounts: accountDocs.size, targets }
}
function publicSummary(data) {
  const reasons = {}
  for (const item of data.targets.filter((target) => target.state === 'blocked')) reasons[item.reason] = (reasons[item.reason] || 0) + 1
  return { families: data.families.length, children: data.targets.length, sourceAccounts: data.accounts,
    queued: data.targets.filter((target) => target.state === 'queued').length, blocked: reasons }
}
function statusRef(target) {
  return db.doc(`families/${target.familyId}/children/${target.childId}/syncStatus/current`)
}
async function status(target, runId, phase, extra = {}) {
  await statusRef(target).set({ runId, phase, updatedAt: Timestamp.now(), ...extra }, { merge: true })
}
function credentialRecord(accountId, kind) {
  if (kind === 'legacy') {
    const file = resolve(local, 'diary', 'secret.json')
    const state = { file, credentials: json(file), save: (updated) => {
      state.credentials = { ...state.credentials, token: updated.token, refreshToken: updated.refreshToken }
      writeJson(dirname(file), basename(file), state.credentials)
    } }
    return state
  }
  const file = resolve(connections, `${accountId}.json`)
  const record = json(file)
  if (sourceKey(record.credentials?.actorPersonId) !== accountId) throw new Error('Локальные полномочия не совпали с источником.')
  const state = { file, credentials: record.credentials, save: (updated) => {
    state.credentials = { ...state.credentials, token: updated.token, refreshToken: updated.refreshToken }
    record.credentials = state.credentials
    writeJson(dirname(file), basename(file), record)
  } }
  return state
}
async function auditPublishedDays(dir, dates) {
  const workspace = dirname(dir)
  const links = readJson(workspace, 'day-links.json') ?? {}
  const dashboardTokens = readJson(workspace, 'day-dashboard-links.json') ?? {}
  const pendingByDate = new Map()
  for (const role of ['student', 'parent']) {
    const expected = buildDayDashboardIndex(workspace, links, role)
    const token = dashboardTokens[role]
    const published = token ? (await db.doc(`dayDashboards/${token}`).get()).data() : null
    for (const item of pendingPublicationDates(expected, published, dates)) {
      const reasons = pendingByDate.get(item.date) ?? new Set()
      for (const reason of item.reasons) reasons.add(`${role}:${reason}`)
      pendingByDate.set(item.date, reasons)
    }
  }
  return [...pendingByDate].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, reasons]) => ({ date, reasons: [...reasons].sort() }))
}
async function collectChild(target, context, runId, today) {
  const dates = dateWindow(today)
  await status(target, runId, 'fetching', { checkedDates: 0, currentDate: null, totalDates: dates.length, reason: null })
  const profile = context.profiles.find((item) => String(item.person_id) === target.sourcePersonId)
  if (!profile) throw new Error('ACCESS_NOT_VERIFIED: ребёнок отсутствует у подключённого взрослого.')
  const secret = { ...context.credentials, personId: String(profile.person_id),
    profileId: String(profile.id), studentId: String(profile.id) }
  const adapter = new MeshDiaryAdapter(secret, context.save)
  await adapter.verifyAccess()
  const loadMarks = adapter.getMarks.bind(adapter)
  let marks
  adapter.getMarks = () => { marks ??= loadMarks(); return marks }
  const dir = target.credentialKind === 'legacy' ? resolve(local, 'diary')
    : resolve(runDir, 'sources', target.familyId, target.childId, 'diary')
  if (target.credentialKind !== 'legacy') writeJson(dirname(dir), 'context.json', {
    familyId: target.familyId, childId: target.childId,
    sourceAccountId: target.sourceAccountId, sourcePersonId: target.sourcePersonId,
  })
  const changes = { lessons: 0, grades: 0, assignments: 0 }
  const changedGradeKeys = new Set()
  const changedDates = []
  let checked = 0, lastFull = null, captures = 0
  for (let index = 0; index < dates.length; index++) {
    const date = dates[index]
    const result = await syncDiary({ adapter, dataDir: dir, date })
    if (!result.complete) {
      const reason = Object.values(result.errors).includes('RATE_LIMITED') ? 'rate-limited'
        : Object.values(result.errors).includes('AUTH_REQUIRED') ? 'auth-required' : 'incomplete-mesh'
      await status(target, runId, 'blocked', { reason, checkedDates: checked, currentDate: date, lastFullMeshAt: lastFull })
      return { state: 'blocked', reason, checkedDates: checked, lastFullMeshAt: lastFull, changes }
    }
    persistMeshCapture({ runDir, runId, familyId: target.familyId, childId: target.childId, snapshot: result })
    captures++
    checked++
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
      await status(target, runId, 'fetching', { checkedDates: checked, totalDates: dates.length, currentDate: date, lastFullMeshAt: lastFull })
    }
  }
  const pendingPublicationDatesByDay = await auditPublishedDays(dir, dates)
  const expected = buildDayDashboardIndex(dirname(dir), readJson(dirname(dir), 'day-links.json') ?? {}, 'student')
  const expectedByDate = new Map((expected.days ?? []).map((day) => [day.date, day]))
  for (const date of new Set([...changedDates.map((item) => item.date), ...pendingPublicationDatesByDay.map((item) => item.date)])) {
    const revision = expectedByDate.get(date)?.sourceRevision
    await enqueueSyncJob(db, { kind: 'reconcile-day', familyId: target.familyId, childId: target.childId,
      sourceId: date, source: { type: 'mesh-day', date }, runId, priority: 25,
      fingerprint: syncFingerprint([date, revision ?? null]) })
  }
  if (Object.values(changes).every((count) => count === 0) && pendingPublicationDatesByDay.length === 0) {
    await status(target, runId, 'complete', { checkedDates: checked, totalDates: dates.length,
      currentDate: dates.at(-1), lastFullMeshAt: lastFull, pendingPublicationCount: 0,
      reason: null, verifiedAt: Timestamp.now() })
    return { state: 'complete', checkedDates: checked, privateCaptures: captures,
      checkedFrom: dates[0], checkedThrough: dates.at(-1), lastFullMeshAt: lastFull,
      changes, changedDates, pendingPublicationDates: pendingPublicationDatesByDay, sourceDir: dir }
  }
  await status(target, runId, 'awaiting-review', { checkedDates: checked, totalDates: dates.length,
    currentDate: dates.at(-1), lastFullMeshAt: lastFull,
    pendingPublicationCount: pendingPublicationDatesByDay.length, reason: 'source-review-required' })
  return { state: 'awaiting-enrichment', checkedDates: checked, privateCaptures: captures,
    checkedFrom: dates[0], checkedThrough: dates.at(-1), lastFullMeshAt: lastFull,
    changes, changedDates, pendingPublicationDates: pendingPublicationDatesByDay, sourceDir: dir }
}
async function collectAccount(accountId, targets, runId, today) {
  const record = credentialRecord(accountId, targets[0].credentialKind)
  const initial = new MeshDiaryAdapter(record.credentials, record.save)
  const profiles = await initial.api.getStudentProfiles(record.credentials.actorPersonId)
  if (!Array.isArray(profiles)) throw new Error('ACCESS_NOT_VERIFIED: список детей МЭШ не получен.')
  const context = { get credentials() { return record.credentials }, profiles, save: record.save }
  const results = []
  for (const target of targets) {
    try {
      const result = await collectChild(target, context, runId, today)
      results.push({ target, result })
      if (result.reason === 'rate-limited' || result.reason === 'auth-required') {
        for (const remaining of targets.slice(results.length)) {
          await status(remaining, runId, 'blocked', { reason: result.reason })
          results.push({ target: remaining, result: { state: 'blocked', reason: result.reason } })
        }
        break
      }
    }
    catch (error) {
      const reason = safeReason(error)
      await status(target, runId, 'blocked', { reason })
      results.push({ target, result: { state: 'blocked', reason } })
      if (reason === 'rate-limited' || reason === 'auth-required') {
        for (const remaining of targets.slice(results.length)) {
          await status(remaining, runId, 'blocked', { reason })
          results.push({ target: remaining, result: { state: 'blocked', reason } })
        }
        break
      }
    }
  }
  return results
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
    const pending = await auditPublishedDays(job.sourceDir, dates)
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
const data = await inventory()
if (command === 'plan') {
  console.log(JSON.stringify({ readOnly: true, ...publicSummary(data) }, null, 2))
} else {
  ensureDataDir(runDir)
  const lock = resolve(runDir, 'active.lock')
  try { writeFileSync(lock, `${process.pid}\n`, { mode: 0o600, flag: 'wx' }) }
  catch { throw new Error('Глобальный сбор уже запущен или остался lock после сбоя; сначала проверьте журнал.') }
  const runId = `${moscowToday()}-${randomUUID()}`
  const today = moscowToday()
  const results = []
  try {
    let openingBatch = db.batch(), openingCount = 0
    for (const target of data.targets) {
      if (target.state === 'blocked') {
        openingBatch.set(statusRef(target), { runId, phase: 'blocked', updatedAt: Timestamp.now(), reason: target.reason }, { merge: true })
        results.push({ target, result: { state: 'blocked', reason: target.reason } })
      } else openingBatch.set(statusRef(target), { runId, phase: 'queued', updatedAt: Timestamp.now(), reason: null, checkedDates: 0 }, { merge: true })
      if (++openingCount === 200) { await openingBatch.commit(); openingBatch = db.batch(); openingCount = 0 }
    }
    if (openingCount) await openingBatch.commit()
    const groups = Map.groupBy(data.targets.filter((item) => item.state === 'queued'), (item) => item.sourceAccountId)
    const completed = await mapBounded([...groups], 2, async ([accountId, targets]) => collectAccount(accountId, targets, runId, today))
    for (let index = 0; index < completed.length; index++) {
      const entry = completed[index]
      if (entry.status === 'fulfilled') results.push(...entry.value)
      else for (const target of [...groups][index][1]) {
        const reason = safeReason(entry.reason)
        await status(target, runId, 'blocked', { reason })
        results.push({ target, result: { state: 'blocked', reason } })
      }
    }
    const manifest = { runId, startedFor: today, finishedAt: new Date().toISOString(),
      inventory: publicSummary(data), jobs: results.map(({ target, result }) => ({
        familyId: target.familyId, childId: target.childId, sourceAccountId: target.sourceAccountId ?? null, ...result,
      })) }
    writeJson(runDir, `run-${runId}.json`, manifest)
    const blocked = results.filter((item) => item.result.state === 'blocked').length
    console.log(JSON.stringify({ runId, families: data.families.length, children: data.targets.length,
      fetched: results.length - blocked, blocked,
      changedDates: results.reduce((sum, item) => sum + (item.result.changedDates?.length ?? 0), 0),
      pendingPublicationDates: results.reduce((sum, item) => sum + (item.result.pendingPublicationDates?.length ?? 0), 0),
      state: blocked === results.length ? 'blocked' : blocked ? 'partially-collected'
        : results.every((item) => item.result.state === 'complete') ? 'complete' : 'awaiting-enrichment-and-publication',
      journal: `project-sync/run-${runId}.json` }, null, 2))
    if (blocked) process.exitCode = 2
  } finally { rmSync(lock, { force: true }) }
}
}
