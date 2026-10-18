import { diffCompleteSnapshots } from '../domain/diff.mjs'
import { normalizeSourceRecords } from '../application/source-pipeline.mjs'

/** @see ../../../docs/services/telegram-bot/operations.md */
/** Read-only, aggregate-only diagnosis of recent confirmed uploads across Firestore families. */
export async function runUploadCheck({ inventory, discoveryStore, source, readCheckpoint, readLedgerEventsByRecord,
  readOutboxJobs, since, clock = () => new Date() } = {}) {
  if (!inventory?.enumerate || !discoveryStore?.prepare || !source?.inspectUpload || !source?.observe
    || !readCheckpoint || !readLedgerEventsByRecord || !readOutboxJobs || !validInstant(since)) throw new Error('upload_check_unavailable')
  const inventoryResult = await inventory.enumerate()
  const prepared = await discoveryStore.prepare(inventoryResult)
  const selected = (prepared.scopes ?? []).filter(({ scope }) => scope?.kind === 'upload')
  const counts = { uploadScopes: selected.length, completeInventory: inventoryResult.complete === true,
    failures: inventoryResult.failures?.length ?? 0, confirmed: 0, intermediate: 0, ignored: 0, unverified: 0,
    recentConfirmed: 0, liveOrigin: 0, bootstrapOrigin: 0, checkpointMissing: 0, checkpointEmpty: 0,
    checkpointHasUpload: 0, checkpointProjectionV2: 0, wouldEmit: 0, pipelineRejected: 0,
    ledgerPresent: 0, ledgerMissing: 0, sentReceipts: 0,
    outboxAbsent: 0, outboxPending: 0, outboxRetry: 0, outboxSent: 0, outboxOther: 0 }
  for (const item of selected) {
    const { scope, origin } = item
    if (origin === 'live') counts.liveOrigin += 1
    else counts.bootstrapOrigin += 1
    const state = await source.inspectUpload(scope)
    if (state.completeness !== 'complete') { counts.unverified += 1; continue }
    if (state.state === 'confirmed') counts.confirmed += 1
    else if (['uploading', 'awaiting_transfer', 'awaiting_storage_confirmation'].includes(state.state)) counts.intermediate += 1
    else counts.ignored += 1
    if (state.state !== 'confirmed' || !validInstant(state.occurredAt) || Date.parse(state.occurredAt) < Date.parse(since)) continue
    counts.recentConfirmed += 1
    const key = source.scopeKey(scope)
    const checkpoint = await readCheckpoint(key)
    const baseline = checkpoint?.baseline ?? null
    if (!checkpoint) counts.checkpointMissing += 1
    else if (!baseline || baseline.records?.length === 0) counts.checkpointEmpty += 1
    if (baseline?.sourceProjectionVersion === 2) counts.checkpointProjectionV2 += 1
    const observation = await source.observe(scope)
    if (observation?.completeness !== 'complete' || !Array.isArray(observation.records)) { counts.unverified += 1; continue }
    const normalizedRecords = normalizeSourceRecords(observation.records)
    if (!normalizedRecords || normalizedRecords.length !== 1) { counts.pipelineRejected += 1; continue }
    const record = normalizedRecords[0]
    const known = Boolean(baseline?.records?.some((candidate) => candidate.recordKey === record.recordKey))
    if (known) counts.checkpointHasUpload += 1
    const eligible = !known && (origin === 'live' || baseline?.sourceProjectionVersion === 2)
    const ledgerRows = await readLedgerEventsByRecord(record.recordKey, key, scope)
    if (eligible) {
      const prior = baseline ?? { complete: true, observationSequence: 0, records: [] }
      const current = { complete: true, observationSequence: (prior.observationSequence ?? 0) + 1, records: [record] }
      const diff = diffCompleteSnapshots({ source: 'firestore', scopeKey: key, familyId: scope.familyId,
        childId: scope.childId, previous: prior, current, detectedAt: clock().toISOString() })
      if (diff.events.some((event) => event.eventType === 'upload.confirmed')) {
        counts.wouldEmit += 1
        if (!ledgerRows.length) { counts.ledgerMissing += 1; counts.outboxAbsent += 1 }
      }
    }
    counts.ledgerPresent += ledgerRows.length
    for (const event of ledgerRows) {
      const jobs = await readOutboxJobs(event.eventId)
      if (!jobs.length) counts.outboxAbsent += 1
      for (const job of jobs) {
        if (job.state === 'sent') { counts.outboxSent += 1; counts.sentReceipts += Number.isSafeInteger(job.receiptCount) ? job.receiptCount : 0 }
        else if (job.state === 'pending' || job.state === 'leased') counts.outboxPending += 1
        else if (job.state === 'retry_wait') counts.outboxRetry += 1
        else counts.outboxOther += 1
      }
    }
  }
  return { schemaVersion: 1, diagnosticOnly: true, since, counts,
    writes: 0, sends: 0, coverageComplete: false,
    diagnosticComplete: inventoryResult.complete === true && counts.unverified === 0 && counts.pipelineRejected === 0 }
}

export function parseUploadCheckArgs(args, now = new Date()) {
  if (!Array.isArray(args)) return null
  if (!args.length) return { since: new Date(now.valueOf() - 72 * 60 * 60_000).toISOString() }
  if (args.length !== 2 || args[0] !== '--since' || !validInstant(args[1])) return null
  return { since: new Date(args[1]).toISOString() }
}

function validInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || Number.isNaN(Date.parse(value))) return false
  const day = value.slice(0, 10)
  const calendarDate = new Date(`${day}T00:00:00.000Z`)
  return !Number.isNaN(calendarDate.valueOf()) && calendarDate.toISOString().slice(0, 10) === day
}
