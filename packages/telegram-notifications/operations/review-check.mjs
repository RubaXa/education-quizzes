import { normalizeSourceRecords } from '../application/source-pipeline.mjs'

/** @see ../../../docs/services/telegram-bot/operations.md */
/** Read-only aggregate diagnosis of registered homework review scopes and recent notifications. */
export async function runReviewCheck({ inventory, discoveryStore, source, readCheckpoint, readLedgerEventsByRecord,
  readOutboxJobs, readGroupOutboxJobs = async () => [], since } = {}) {
  if (!inventory?.enumerate || !discoveryStore?.prepare || !source?.inspectReview || !source?.observe
    || !readCheckpoint || !readLedgerEventsByRecord || !readOutboxJobs || !validInstant(since)) throw new Error('review_check_unavailable')
  const inventoryResult = await inventory.enumerate()
  const prepared = await discoveryStore.prepare(inventoryResult)
  const selected = (prepared.scopes ?? []).filter(({ scope }) => scope?.kind === 'progress')
  const counts = { reviewScopes: selected.length, completeInventory: inventoryResult.complete === true,
    failures: inventoryResult.failures?.length ?? 0, reviewed: 0, missing: 0, invalid: 0, ignored: 0, unverified: 0,
    missingContextScopes: 0, invalidContextScopes: 0, checkedAtPresent: 0, checkedAtMissing: 0,
    recentReviewed: 0, missingSubject: 0, missingTitle: 0, missingSubjectOrTitle: 0,
    baselinePresent: 0, baselineMissing: 0, sameStatusRevisions: 0,
    ledgerPresent: 0, ledgerMissing: 0, recentLedgerEvents: 0, outboxAbsent: 0, outboxPending: 0, outboxRetry: 0,
    outboxSent: 0, outboxOther: 0, groupedOutbox: 0, sentDigestJobs: 0, eventCoveredReceipts: 0 }

  const countedGroupJobs = new Set()
  const countedEventJobs = new Set()
  const contextReasons = {}
  for (const { scope } of selected) {
    const state = await source.inspectReview(scope)
    if (typeof state?.contextReason === 'string' && /^[a-z_]{1,48}$/.test(state.contextReason)) contextReasons[state.contextReason] = (contextReasons[state.contextReason] ?? 0) + 1
    if (state?.contextState === 'missing' && !['missing', 'ignored'].includes(state.state)) counts.missingContextScopes += 1
    if (state?.contextState === 'invalid') counts.invalidContextScopes += 1
    if (state?.checkedAtPresent === true) counts.checkedAtPresent += 1
    else if (state?.checkedAtPresent === false) counts.checkedAtMissing += 1
    if (state?.state === 'ignored') { counts.ignored += 1; continue }
    if (state?.completeness !== 'complete') { counts.unverified += 1; continue }
    if (state.state === 'missing') { counts.missing += 1; continue }
    if (state.state === 'invalid_scope' || state.state === 'observation_failed' || state.state === 'invalid') { counts.invalid += 1; continue }
    if (!['verified', 'needs-fix', 'partial', 'cannot-assess'].includes(state.state)) { counts.unverified += 1; continue }
    counts.reviewed += 1

    const observation = await source.observe(scope)
    if (observation?.completeness !== 'complete' || !Array.isArray(observation.records)
      || observation.familyId !== scope.familyId || observation.childId !== scope.childId) { counts.unverified += 1; continue }
    const records = normalizeSourceRecords(observation.records)
    if (!records || records.length > 1) { counts.unverified += 1; continue }
    const current = records[0] ?? null
    if (current) {
      const hasSubject = Boolean(current.fields?.subject?.trim())
      const hasTitle = Boolean(current.fields?.title?.trim())
      if (!hasSubject) counts.missingSubject += 1
      if (!hasTitle) counts.missingTitle += 1
      if (!hasSubject || !hasTitle) counts.missingSubjectOrTitle += 1
    }
    const key = source.scopeKey(scope)
    const checkpoint = await readCheckpoint(key)
    const baseline = checkpoint?.baseline ?? null
    const previous = baseline?.records?.find((record) => record?.recordKey === current?.recordKey) ?? null
    if (previous) counts.baselinePresent += 1
    else counts.baselineMissing += 1
    const ledgerRows = current ? await readLedgerEventsByRecord(current.recordKey, key, scope) : []
    counts.ledgerPresent += ledgerRows.length
    if (!ledgerRows.length) counts.ledgerMissing += 1
    const recentLedgerRows = ledgerRows.filter((event) => validInstant(event.detectedAt) && Date.parse(event.detectedAt) >= Date.parse(since))
    if (recentLedgerRows.length) counts.recentReviewed += 1
    counts.recentLedgerEvents += recentLedgerRows.length
    counts.sameStatusRevisions += countSameStatusRevisions(recentLedgerRows)
    if (!recentLedgerRows.length) continue
    for (const event of recentLedgerRows) {
      const jobs = await readOutboxJobs(event.eventId)
      if (!jobs.length) counts.outboxAbsent += 1
      for (const job of jobs) {
        if (job.isDigest === true || (job.jobId && countedEventJobs.has(job.jobId))) continue
        if (job.jobId) countedEventJobs.add(job.jobId)
        if (job.groupedInto) {
          const groupJobs = await readGroupOutboxJobs(job.groupedInto)
          if (!groupJobs.length) { counts.outboxAbsent += 1; continue }
          for (const digest of groupJobs) {
            if (!Array.isArray(digest.eventJobIds) || !digest.eventJobIds.includes(job.jobId)  ) continue
            counts.groupedOutbox += 1
            if (digest.state === 'sent') counts.eventCoveredReceipts += Number.isSafeInteger(digest.receiptCount) ? digest.receiptCount : 0
            if (!countedGroupJobs.has(digest.jobId)) {
              countedGroupJobs.add(digest.jobId)
              countJob(digest, counts, { grouped: true })
            }
          }
        } else countJob(job, counts)
      }
    }
  }
  return { schemaVersion: 1, diagnosticOnly: true, since, counts, writes: 0, sends: 0,
    coverageComplete: false, contextReasons, sameStatusRevisionCause: 'unknown',
    diagnosticComplete: inventoryResult.complete === true && counts.unverified === 0 && counts.invalid === 0 }
}

function countJob(job, counts, { grouped = false } = {}) {
  if (job.state === 'sent') {
    counts.outboxSent += 1
    if (!grouped) counts.eventCoveredReceipts += Number.isSafeInteger(job.receiptCount) ? job.receiptCount : 0
    if (grouped) counts.sentDigestJobs += 1
  }
  else if (job.state === 'pending' || job.state === 'leased' || job.state === 'grouped') counts.outboxPending += 1
  else if (job.state === 'retry_wait') counts.outboxRetry += 1
  else counts.outboxOther += 1
}

function countSameStatusRevisions(events) {
  const recent = [...events].sort((left, right) => left.detectedAt.localeCompare(right.detectedAt))
  let count = 0
  for (let index = 1; index < recent.length; index += 1) {
    const previous = recent[index - 1], current = recent[index]
    if (previous.fields?.status && previous.fields.status === current.fields?.status
      && previous.fields?.subject === current.fields?.subject
      && previous.sourceRevision !== current.sourceRevision) count += 1
  }
  return count
}

export function parseReviewCheckArgs(args, now = new Date()) {
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
