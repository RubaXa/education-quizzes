import { createHash } from 'node:crypto'
import { diffCompleteSnapshots } from '../domain/diff.mjs'
import { normalizeSourceRecords } from '../application/source-pipeline.mjs'

/** @see ../../../docs/services/telegram-bot/operations.md */
/** Read-only comparison of authorized Mesh observations with notify checkpoints and durable delivery receipts. */
export async function runMeshDeliveryCheck({ inventory, discoveryStore, source, readCheckpoint,
  readLedgerEventsByRecord, readOutboxJobs, since, limit = null, concurrency = 4, clock = () => new Date() } = {}) {
  if (!inventory?.enumerate || !discoveryStore?.prepare || !source?.observe || !source?.scopeKey
    || !readCheckpoint || !readLedgerEventsByRecord || !readOutboxJobs || !validInstant(since)
    || (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 10_000))
    || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw new Error('mesh_delivery_check_unavailable')
  const inventoryResult = await inventory.enumerate()
  const prepared = await discoveryStore.prepare(inventoryResult)
  const all = (prepared.scopes ?? []).filter(({ source: kind }) => kind === 'mesh')
  const selected = limit === null ? all : all.slice(0, limit)
  const counts = { registeredScopes: all.length, observedScopes: 0, completeScopes: 0, partialScopes: 0,
    checkpointMissing: 0, checkpointStale: 0, checkpointFresh: 0, checkpointFreshnessUnknown: 0, quietBootstrap: 0, candidateEvents: 0,
    pendingEvents: 0, ledgerEvents: 0, recentLedgerEvents: 0, missingLedger: 0, outboxJobs: 0, outboxPending: 0,
    outboxRetry: 0, outboxSent: 0, receiptlessSentJobs: 0, eventCoveredReceipts: 0,
    uniqueTelegramMessages: 0, outboxOther: 0 }
  const countedMessages = new Set()
  const records = []
  let cursor = 0
  let failed = false
  async function worker() {
    while (cursor < selected.length) {
      const item = selected[cursor++]
      try {
        const { scope, origin } = item
        const scopeKey = source.scopeKey(scope)
        const checkpoint = await readCheckpoint(scopeKey)
        const baseline = checkpoint?.baseline ?? null
        counts.observedScopes += 1
        if (!checkpoint) counts.checkpointMissing += 1
        // updatedAt can move on lease renewal; only the baseline's observation timestamp proves source freshness.
        const checkpointTime = baseline?.observedAt ?? null
        const observedAt = clock().toISOString()
        if (validInstant(checkpointTime)) {
          if (Date.parse(observedAt) - Date.parse(checkpointTime) > 24 * 60 * 60_000) counts.checkpointStale += 1
          else counts.checkpointFresh += 1
        } else counts.checkpointFreshnessUnknown += 1
        const observation = await source.observe(scope)
        if (observation?.completeness !== 'complete' || observation.source !== 'mesh' || observation.scopeKey !== scopeKey
          || observation.familyId !== scope.familyId || observation.childId !== scope.childId || !Array.isArray(observation.records)) {
          counts.partialScopes += 1; failed = true; continue
        }
        const normalized = normalizeSourceRecords(observation.records)
        if (!normalized) { counts.partialScopes += 1; failed = true; continue }
        counts.completeScopes += 1
        const prior = baseline ?? { complete: true, observationSequence: 0, records: [] }
        const currentRecords = mergeRecords(prior.records ?? [], normalized)
        const current = { complete: true, observationSequence: (prior.observationSequence ?? 0) + 1,
          sourceProjectionVersion: 2, records: currentRecords }
        const diffRecords = baseline ? currentRecords : (origin === 'live' ? normalized : [])
        const diff = diffCompleteSnapshots({ source: 'mesh', scopeKey, familyId: scope.familyId, childId: scope.childId,
          previous: prior, current: { ...current, records: diffRecords }, detectedAt: observedAt })
        if (!baseline && origin === 'bootstrap') counts.quietBootstrap += 1
        // A newly observed Mesh delta is detected now even when the grade itself is dated earlier.
        if (Date.parse(observedAt) >= Date.parse(since)) counts.candidateEvents += diff.events.length
        const pending = checkpoint?.pending?.events ?? []
        counts.pendingEvents += pending.length
        const candidates = new Map()
        for (const event of [...diff.events, ...pending]) {
          if (event.sourceEventKey) candidates.set(event.sourceEventKey, event)
        }
        // Inspect natural existing records too, so a completed delivery remains provable after checkpoint advance.
        for (const record of currentRecords) {
          const existing = baseline?.records?.find((row) => row.recordKey === record.recordKey)
          const occurredAt = record.occurredAt ?? null
          const candidateKey = digestFull(record.recordKey)
          const event = candidates.get(candidateKey) ?? (existing ? { sourceEventKey: candidateKey,
            eventType: record.eventType ?? null, occurredAt, fields: record.fields ?? {} } : null)
          if (!event) continue
          const ledger = await readLedgerEventsByRecord(record.recordKey, scopeKey, scope)
          counts.ledgerEvents += ledger.length
          const recentLedger = ledger.filter((row) => validInstant(row.detectedAt) && Date.parse(row.detectedAt) >= Date.parse(since))
          counts.recentLedgerEvents += recentLedger.length
          if (!ledger.length && candidates.has(candidateKey)) counts.missingLedger += 1
          let delivered = false
          let eventCoveredReceipts = 0
          const ledgerEventIds = []
          const detectedAtValues = []
          for (const ledgerEvent of recentLedger) {
            ledgerEventIds.push(ledgerEvent.eventId)
            detectedAtValues.push(ledgerEvent.detectedAt)
            const jobs = await readOutboxJobs(ledgerEvent.eventId)
            counts.outboxJobs += jobs.length
            for (const job of jobs) {
              const receipts = Array.isArray(job.receiptIds) ? job.receiptIds.filter(Number.isSafeInteger) : []
              const receiptCount = Number.isSafeInteger(job.receiptCount) ? job.receiptCount : receipts.length
              if (job.state === 'sent') {
                counts.outboxSent += 1
                if (receiptCount > 0) {
                  delivered = true
                  eventCoveredReceipts += receiptCount
                  for (let index = 0; index < receiptCount; index += 1) {
                    countedMessages.add(`${job.jobId ?? ledgerEvent.eventId}:${receipts[index] ?? index}`)
                  }
                } else counts.receiptlessSentJobs += 1
              }
              else if (job.state === 'pending' || job.state === 'leased' || job.state === 'grouped') counts.outboxPending += 1
              else if (job.state === 'retry_wait') counts.outboxRetry += 1
              else counts.outboxOther += 1
            }
          }
          counts.eventCoveredReceipts += eventCoveredReceipts > 0 ? 1 : 0
          if (!candidates.has(candidateKey) && recentLedger.length === 0) continue
          records.push({ scopeKind: safeKind(scope.kind), date: safeDate(scope.date ?? record.occurredAt),
            eventType: safeEventType(recentLedger.find((row) => row.eventType)?.eventType ?? event.eventType ?? inferEventType(record)), subject: safeSubject(event.fields?.subject ?? record.fields?.subject),
            sourceDigest: digest(record.recordKey), checkpointContainsRecord: Boolean(existing), ledgerEvents: recentLedger.length,
            eventIds: [...new Set(ledgerEventIds.filter((id) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)))],
            detectedAt: [...new Set(detectedAtValues.filter(validInstant))].sort(), eventCoveredReceipts,
            sent: delivered })
        }
      } catch { counts.partialScopes += 1; failed = true }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker))
  records.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.sourceDigest.localeCompare(b.sourceDigest))
  counts.uniqueTelegramMessages = countedMessages.size
  return { schemaVersion: 1, diagnosticOnly: true, since, counts, records,
    coverageComplete: inventoryResult.complete === true && selected.length === all.length && counts.partialScopes === 0,
    truncated: selected.length < all.length, writes: 0, sends: 0,
    diagnosticComplete: !failed && inventoryResult.complete === true && selected.length === all.length }
}

function mergeRecords(previous, current) {
  const rows = new Map(previous.map((item) => [item.recordKey, item]))
  for (const item of current) rows.set(item.recordKey, item)
  return [...rows.values()]
}
function inferEventType(record) {
  return ({ grade: 'grade.created', schedule: 'schedule.created', assignment: 'homework.assigned' })[record.kind] ?? null
}
function safeKind(value) { return ['grades', 'schedule', 'homework'].includes(value) ? value : 'unknown' }
function safeEventType(value) { return typeof value === 'string' && /^[a-z]+\.[a-z-]+$/.test(value) ? value : 'unknown' }
function safeDate(value) { const candidate = typeof value === 'string' ? value.slice(0, 10) : ''; return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null }
function safeSubject(value) {
  if (typeof value !== 'string') return null
  // The value is already a normalized subject projection; strip any control bytes before reporting it.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) || null
}
function digest(value) { return createHash('sha256').update(String(value)).digest('hex').slice(0, 16) }
function digestFull(value) { return createHash('sha256').update(String(value)).digest('hex') }
function validInstant(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) }
