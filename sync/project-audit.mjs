import { dateWindow } from './project-plan.mjs'
import { realpathSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const RUN_ID = /^\d{4}-\d{2}-\d{2}-[a-f0-9-]{36}$/
const OWNER_ID = /^[A-Za-z0-9_-]{1,120}$/

/** Accept this child's canonical source path or an explicitly owned legacy diary. */
export function resolveProjectAuditSourcePath(job, { localDir, runDir, legacyOwner }) {
  const path = resolve(job?.sourceDir ?? '')
  const realLocal = realpathSync(localDir)
  const realPath = realpathSync(path)
  const legacyPath = resolve(localDir, 'diary')
  if (path === legacyPath && realPath === resolve(realLocal, 'diary')
    && legacyOwner?.familyId === job?.familyId && legacyOwner?.childId === job?.childId) return path
  const realRun = realpathSync(runDir)
  const ownerDir = resolve(realRun, 'sources', job?.familyId ?? '', job?.childId ?? '')
  const expectedDiary = resolve(ownerDir, 'diary')
  if (path === resolve(runDir, 'sources', job?.familyId ?? '', job?.childId ?? '', 'diary') && realPath === expectedDiary) {
    const contextPath = resolve(ownerDir, 'context.json')
    if (realpathSync(contextPath) !== contextPath) throw new Error('Контекст снимков не принадлежит владельцу запуска.')
    const context = JSON.parse(readFileSync(contextPath, 'utf8'))
    if (context.familyId === job.familyId && context.childId === job.childId) return path
    throw new Error('Контекст снимков не принадлежит владельцу запуска.')
  }
  throw new Error('Путь снимков не принадлежит владельцу запуска.')
}

/** Validate a previously collected run before read-only publication auditing.
 * @see ../docs/modules/synchronization/global-sync.md#publication-audit
 * @see ../docs/decisions/project-publication-audit-2026-10-21.md
 */
export async function runProjectPublicationAudit({ runId, manifest, readSyncStatus, resolveSourcePath, readSnapshot,
  auditPublishedDays, writeReceipt, now = () => new Date().toISOString() }) {
  if (!RUN_ID.test(runId ?? '')) throw new Error('Нужен корректный идентификатор запуска.')
  if (manifest?.runId !== runId) throw new Error('Манифест не относится к указанному запуску.')
  const dates = dateWindow(manifest.startedFor)
  const jobs = manifest.jobs ?? []
  if (!Array.isArray(jobs) || jobs.some((item) => !OWNER_ID.test(item?.familyId ?? '') || !OWNER_ID.test(item?.childId ?? ''))) {
    throw new Error('В манифесте есть задание без корректного владельца.')
  }
  const ownerKeys = jobs.map((item) => `${item.familyId}/${item.childId}`)
  if (new Set(ownerKeys).size !== ownerKeys.length) throw new Error('В манифесте повторяется владелец запуска.')
  if (!jobs.length) throw new Error('В манифесте запуска нет заданий для аудита.')
  const results = []
  for (const job of jobs) {
    const target = { familyId: job.familyId, childId: job.childId }
    if ((await readSyncStatus(target))?.runId !== runId) throw new Error(`Текущий статус ${job.familyId}/${job.childId} уже относится к другому запуску.`)
    const sourceDir = resolveSourcePath(job)
    if (!job.sourceDir || sourceDir !== job.sourceDir || !sourceDir) throw new Error('Путь снимков не принадлежит владельцу запуска.')
    if (job.checkedFrom !== dates[0] || job.checkedThrough !== dates.at(-1) || job.checkedDates !== dates.length) {
      throw new Error(`Манифест ${job.familyId}/${job.childId} не подтверждает точное окно из 42 дат.`)
    }
    for (const date of dates) {
      const snapshot = await readSnapshot(sourceDir, date)
      if (!snapshot?.complete || snapshot.date !== date) throw new Error(`Нет полного снимка МЭШ за ${date} для ${job.familyId}/${job.childId}.`)
    }
    let audit
    try { audit = await auditPublishedDays(sourceDir, dates, manifest.startedFor, target) }
    catch {
      results.push({ ...target, status: 'blocked', reason: 'publication-audit-failed', pendingPublicationDates: null })
      continue
    }
    if (!Array.isArray(audit?.pending) || !(audit.expectedByDate instanceof Map)
      || [...audit.expectedByDate.keys()].some((date) => !dates.includes(date))) {
      results.push({ ...target, status: 'blocked', reason: 'publication-audit-incomplete', pendingPublicationDates: null })
      continue
    }
    const pendingPublicationDates = audit.pending.map(({ date, reasons }) => ({ date, reasons }))
    if (pendingPublicationDates.some((item) => !dates.includes(item.date) || !Array.isArray(item.reasons))) {
      results.push({ ...target, status: 'blocked', reason: 'publication-audit-invalid', pendingPublicationDates: null })
      continue
    }
    results.push({ ...target, status: pendingPublicationDates.length ? 'pending' : 'publication-verified',
      reason: null, pendingPublicationDates })
  }
  for (const job of jobs) {
    if ((await readSyncStatus({ familyId: job.familyId, childId: job.childId }))?.runId !== runId) {
      throw new Error(`Текущий статус ${job.familyId}/${job.childId} сменился во время аудита.`)
    }
  }
  const status = results.some((item) => item.status === 'blocked') ? 'blocked'
    : results.some((item) => item.status === 'pending') ? 'pending' : 'publication-verified'
  const receipt = { schemaVersion: 1, kind: 'project-publication-audit', runId, status,
    readOnly: true, receiptReadOnly: true, startedFor: manifest.startedFor,
    checkedFrom: dates[0], checkedThrough: dates.at(-1), checkedDates: dates.length, auditedAt: now(), results,
    pendingPublicationDates: results.flatMap((item) => item.pendingPublicationDates ?? []),
    blockedCount: results.filter((item) => item.status === 'blocked').length,
    pendingCount: results.filter((item) => item.status === 'pending').length,
    publicationVerified: status === 'publication-verified' && dates.length === 42,
    // This receipt reports publication only. It never advances the sync workflow.
    workflowPhaseChanged: false }
  await writeReceipt(receipt)
  return receipt
}
