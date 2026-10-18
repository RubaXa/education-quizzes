import { describe, expect, it, vi } from 'vitest'
import { parseReviewCheckArgs, runReviewCheck } from './review-check.mjs'

const scope = { familyId: 'family-private', childId: 'child-private', kind: 'progress', dayToken: 'day-private', recordId: 'task-private' }
const record = { recordKey: 'a'.repeat(64), kind: 'review', eventType: 'review.changed', semanticHash: 'b'.repeat(64),
  occurredAt: '2026-10-18T08:00:00.000Z', fields: { childName: 'Private Name', subject: 'Math', title: 'Private title', status: 'verified' } }

function fixture(overrides = {}) {
  const readCheckpoint = vi.fn(async () => ({ baseline: { records: [{ ...record, semanticHash: 'c'.repeat(64) }] } }))
  const readLedgerEventsByRecord = vi.fn(async () => [
    { eventId: 'event-old', sourceRevision: 'revision-old', detectedAt: '2026-10-18T07:00:00.000Z', fields: { status: 'verified', subject: 'Math' } },
    { eventId: 'event-private', sourceRevision: 'revision-new', detectedAt: '2026-10-18T08:00:00.000Z', fields: { status: 'verified', subject: 'Math' } },
  ])
  const readOutboxJobs = vi.fn(async () => [{ state: 'grouped', groupedInto: 'group-private', jobId: 'job-private' }])
  const readGroupOutboxJobs = vi.fn(async () => [{ jobId: 'digest-private', state: 'sent', receiptCount: 1, eventJobIds: ['job-private'] }])
  const deps = { inventory: { async enumerate() { return { complete: true, failures: [], scopes: [{ source: 'firestore', scope }] } } },
    discoveryStore: { async prepare(inventory) { return { ...inventory, scopes: [{ source: 'firestore', scope, origin: 'live' }] } } },
    source: { scopeKey: () => 'opaque-scope', async inspectReview() { return { completeness: 'complete', state: 'verified', checkedAt: '2026-10-18T08:00:00.000Z' } },
      async observe() { return { completeness: 'complete', familyId: scope.familyId, childId: scope.childId, records: [record] } } },
    readCheckpoint, readLedgerEventsByRecord, readOutboxJobs, readGroupOutboxJobs,
    since: '2026-10-18T00:00:00.000Z', ...overrides }
  return { deps, readCheckpoint, readLedgerEventsByRecord, readOutboxJobs, readGroupOutboxJobs }
}

describe('review-check', () => {
  it('counts one shared digest once across distinct review records while retaining event coverage', async () => {
    const f = fixture()
    f.deps.inventory.enumerate = async () => ({ complete: true, failures: [], scopes: [] })
    f.deps.discoveryStore.prepare = async () => ({ scopes: [scope, { ...scope, recordId: 'task-other' }].map(scope => ({ scope })) })
    f.deps.source.observe = async selected => ({ completeness: 'complete', familyId: scope.familyId, childId: scope.childId,
      records: [{ ...record, recordKey: selected.recordId === 'task-other' ? 'd'.repeat(64) : record.recordKey }] })
    f.deps.readLedgerEventsByRecord = async key => [{ eventId: key, detectedAt: '2026-10-18T08:00:00.000Z' }]
    f.deps.readOutboxJobs = async id => [{ jobId: `${id}-job`, groupedInto: 'digest-one' }]
    f.deps.readGroupOutboxJobs = async () => [{ jobId: 'digest-one', state: 'sent', receiptCount: 1,
      eventJobIds: [`${record.recordKey}-job`, `${'d'.repeat(64)}-job`] }]
    const result = await runReviewCheck(f.deps)
    expect(result.counts).toMatchObject({ recentLedgerEvents: 2, sentDigestJobs: 1, groupedOutbox: 2,
      outboxSent: 1, eventCoveredReceipts: 2 })
  })

  it('distinguishes absent reviews and source-material processing from missing task context', async () => {
    const f = fixture({ source: { scopeKey: () => 'opaque-scope', observe: async () => { throw Error('must not read') },
      inspectReview: async () => ({ completeness: 'complete', state: 'missing', contextState: 'missing' }) } })
    expect((await runReviewCheck(f.deps)).counts).toMatchObject({ missing: 1, missingContextScopes: 0 })
    f.deps.source.inspectReview = async () => ({ completeness: 'complete', state: 'ignored', contextState: 'missing' })
    expect((await runReviewCheck(f.deps)).counts).toMatchObject({ ignored: 1, missingContextScopes: 0 })
  })

  it('parses a bounded optional observation window', () => {
    expect(parseReviewCheckArgs([], new Date('2026-10-18T12:00:00Z'))).toEqual({ since: '2026-10-15T12:00:00.000Z' })
    expect(parseReviewCheckArgs(['--since', '2026-10-18T00:00:00Z'])).toEqual({ since: '2026-10-18T00:00:00.000Z' })
    expect(parseReviewCheckArgs(['--since', '2026-02-30T00:00:00Z'])).toBeNull()
    expect(parseReviewCheckArgs(['--apply'])).toBeNull()
  })

  it('reports aggregate review context, timestamp-only baseline drift, and grouped delivery receipts', async () => {
    const f = fixture()
    const result = await runReviewCheck(f.deps)
    expect(result).toMatchObject({ diagnosticOnly: true, writes: 0, sends: 0, coverageComplete: false, diagnosticComplete: true,
      sameStatusRevisionCause: 'unknown', counts: { reviewScopes: 1, reviewed: 1, recentReviewed: 1, missingSubjectOrTitle: 0,
        baselinePresent: 1, sameStatusRevisions: 1, ledgerPresent: 2, recentLedgerEvents: 2,
        outboxSent: 1, groupedOutbox: 1, sentDigestJobs: 1, eventCoveredReceipts: 1 } })
    expect(f.readCheckpoint).toHaveBeenCalledWith('opaque-scope')
    expect(f.readLedgerEventsByRecord).toHaveBeenCalledTimes(1)
    expect(f.readOutboxJobs).toHaveBeenCalledWith('event-private')
    expect(f.readGroupOutboxJobs).toHaveBeenCalledWith('group-private')
    expect(JSON.stringify(result)).not.toMatch(/family-private|child-private|day-private|task-private|Private Name|Private title|Math|event-private|job-private|group-private/)
  })

  it('counts absent subject or title without returning content or identifiers', async () => {
    const f = fixture({ source: { scopeKey: () => 'opaque-scope', async inspectReview() { return { completeness: 'complete', state: 'verified', checkedAt: '2026-10-18T08:00:00.000Z' } },
      async observe() { return { completeness: 'complete', familyId: scope.familyId, childId: scope.childId,
        records: [{ ...record, fields: { status: 'verified', title: 'Private title' } }] } } },
      readLedgerEventsByRecord: async () => [], readOutboxJobs: async () => [] })
    const result = await runReviewCheck(f.deps)
    expect(result.counts).toMatchObject({ missingSubject: 1, missingTitle: 0, missingSubjectOrTitle: 1, ledgerMissing: 1, recentReviewed: 0 })
    expect(JSON.stringify(result)).not.toMatch(/Private title|task-private|family-private/)
  })

  it('does not claim a complete diagnostic for incomplete source observations', async () => {
    const f = fixture({ source: { scopeKey: () => 'opaque', async inspectReview() { return { completeness: 'complete', state: 'verified', checkedAt: '2026-10-18T08:00:00Z' } },
      async observe() { return { completeness: 'partial', familyId: scope.familyId, childId: scope.childId, records: [] } } } })
    const result = await runReviewCheck(f.deps)
    expect(result.diagnosticComplete).toBe(false)
    expect(result.counts.unverified).toBe(1)
  })

  it('reports missing review context separately from unavailable source reads', async () => {
    const f = fixture({ source: { scopeKey: () => 'opaque', async inspectReview() {
      return { completeness: 'partial', state: 'verified', contextState: 'missing', checkedAtPresent: false }
    }, async observe() { return { completeness: 'partial', familyId: scope.familyId, childId: scope.childId, records: [] } } } })
    const result = await runReviewCheck(f.deps)
    expect(result.diagnosticComplete).toBe(false)
    expect(result.counts).toMatchObject({ reviewScopes: 1, missingContextScopes: 1, checkedAtMissing: 1, unverified: 1 })
    expect(JSON.stringify(result)).not.toMatch(/family-private|child-private|task-private/)
  })
})
