import { describe, expect, it, vi } from 'vitest'
import { runMeshDeliveryCheck } from './mesh-delivery-check.mjs'

const scope = { familyId: 'private-family', childId: 'private-child', kind: 'grades', sourceAccountId: 'private-account',
  sourcePersonId: 'private-person', subjectId: '1', periodKey: '2026-09-01' }
const record = { recordKey: 'a'.repeat(64), kind: 'grade', semanticHash: 'b'.repeat(64), occurredAt: '2026-10-18T12:00:00.000Z',
  fields: { childName: 'Иван', subject: 'Математика', title: 'Контрольная', value: '5', occurredLabel: '2026-10-18' } }
const instant = '2026-10-18T00:00:00.000Z'

function deps({ baseline = null, origin = 'live', ledger = [], jobs = [] } = {}) {
  const readCheckpoint = vi.fn(async () => baseline ? { baseline, updatedAt: instant, pending: null } : null)
  const readLedgerEventsByRecord = vi.fn(async () => ledger)
  const readOutboxJobs = vi.fn(async () => jobs)
  return { inventory: { async enumerate() { return { complete: true, scopes: [{ source: 'mesh', scope }] } } },
    discoveryStore: { async prepare(input) { return { ...input, scopes: [{ source: 'mesh', scope, origin }] } } },
    source: { scopeKey: () => 'opaque-scope', async observe() { return { source: 'mesh', scopeKey: 'opaque-scope', familyId: scope.familyId,
      childId: scope.childId, completeness: 'complete', records: [record] } } }, readCheckpoint, readLedgerEventsByRecord, readOutboxJobs,
    since: instant, clock: () => new Date('2026-10-19T00:00:00.000Z') }
}

describe('mesh-delivery-check', () => {
  it('compares a live delta and reports missing ledger/outbox without writes or private identifiers', async () => {
    const f = deps()
    const result = await runMeshDeliveryCheck(f)
    expect(result).toMatchObject({ diagnosticOnly: true, coverageComplete: true, diagnosticComplete: true, writes: 0, sends: 0,
      counts: { registeredScopes: 1, completeScopes: 1, candidateEvents: 1, missingLedger: 1, outboxJobs: 0 } })
    expect(f.readCheckpoint).toHaveBeenCalledWith('opaque-scope')
    expect(f.readLedgerEventsByRecord).toHaveBeenCalledWith(record.recordKey, 'opaque-scope', scope)
    expect(JSON.stringify(result)).not.toMatch(/private-family|private-child|private-account|private-person|Иван|Контрольная/)
    expect(result.records[0]).toMatchObject({ eventType: 'grade.created', date: '2026-10-18', subject: 'Математика', ledgerEvents: 0 })
  })

  it('keeps a missing baseline quiet on first bootstrap observation', async () => {
    const result = await runMeshDeliveryCheck(deps({ origin: 'bootstrap' }))
    expect(result.counts).toMatchObject({ quietBootstrap: 1, candidateEvents: 0, missingLedger: 0 })
  })

  it('reports actual ledger/outbox receipt after checkpoint already contains the record', async () => {
    const f = deps({ baseline: { complete: true, observationSequence: 4,
      sourceProjectionVersion: 2, observedAt: '2026-10-18T23:59:00.000Z', records: [record] }, ledger: [{ eventId: 'a'.repeat(64), eventType: 'grade.created',
      detectedAt: '2026-10-19T00:00:00.000Z' }],
    jobs: [{ jobId: 'job-hash', state: 'sent', receiptCount: 1, receiptIds: [17] }] })
    f.since = '2026-10-19T00:00:00.000Z'
    const result = await runMeshDeliveryCheck(f)
    expect(result.counts).toMatchObject({ checkpointFresh: 1, ledgerEvents: 1, outboxSent: 1,
      eventCoveredReceipts: 1, uniqueTelegramMessages: 1 })
    expect(result.records[0]).toMatchObject({ checkpointContainsRecord: true, sent: true,
      eventIds: ['a'.repeat(64)], detectedAt: ['2026-10-19T00:00:00.000Z'], eventCoveredReceipts: 1 })
    expect(result.records[0].sourceDigest).not.toBe(record.recordKey)
  })

  it('makes a requested scope limit explicit and incomplete', async () => {
    const f = deps()
    f.inventory.enumerate = async () => ({ complete: true, scopes: [{ source: 'mesh', scope }, { source: 'mesh', scope: { ...scope, date: '2026-10-19' } }] })
    f.discoveryStore.prepare = async (input) => ({ ...input, scopes: input.scopes.map((item) => ({ ...item, origin: 'bootstrap' })) })
    const result = await runMeshDeliveryCheck({ ...f, limit: 1 })
    expect(result).toMatchObject({ truncated: true, coverageComplete: false, diagnosticComplete: false })
  })

  it('does not infer freshness from a recently renewed checkpoint when baseline observation time is absent', async () => {
    const f = deps({ baseline: { complete: true, observationSequence: 4, records: [record] } })
    f.readCheckpoint = async () => ({ updatedAt: '2026-10-19T00:00:00.000Z',
      baseline: { complete: true, observationSequence: 4, records: [record] } })
    const result = await runMeshDeliveryCheck(f)
    expect(result.counts).toMatchObject({ checkpointFresh: 0, checkpointFreshnessUnknown: 1, checkpointStale: 0 })
  })

  it('classifies a rejected normalized observation as partial, not complete', async () => {
    const f = deps()
    f.source.observe = async () => ({ source: 'mesh', scopeKey: 'opaque-scope', familyId: scope.familyId,
      childId: scope.childId, completeness: 'complete', records: [{ ...record, fields: { privateUnexpectedField: 'bad' } }] })
    const result = await runMeshDeliveryCheck(f)
    expect(result.counts).toMatchObject({ completeScopes: 0, partialScopes: 1 })
    expect(result.coverageComplete).toBe(false)
  })

  it('does not call a sent job delivered without a receipt', async () => {
    const f = deps({ baseline: { complete: true, observationSequence: 4, sourceProjectionVersion: 2,
      observedAt: '2026-10-18T23:59:00.000Z', records: [record] },
    ledger: [{ eventId: 'c'.repeat(64), eventType: 'grade.created', detectedAt: '2026-10-19T00:00:00.000Z' }],
    jobs: [{ jobId: 'receiptless', state: 'sent', receiptCount: 0, receiptIds: [] }] })
    f.since = '2026-10-19T00:00:00.000Z'
    const result = await runMeshDeliveryCheck(f)
    expect(result.counts).toMatchObject({ outboxSent: 1, receiptlessSentJobs: 1, uniqueTelegramMessages: 0 })
    expect(result.records[0]).toMatchObject({ sent: false, eventCoveredReceipts: 0 })
  })

  it('counts five event-covered receipts but deduplicates the one shared digest message', async () => {
    const records = Array.from({ length: 5 }, (_, index) => ({ ...record, recordKey: String(index + 1).repeat(64),
      semanticHash: 'abcdef'[index].repeat(64) }))
    const f = deps()
    f.source.observe = async () => ({ source: 'mesh', scopeKey: 'opaque-scope', familyId: scope.familyId,
      childId: scope.childId, completeness: 'complete', records })
    f.readLedgerEventsByRecord = async (recordKey) => [{ eventId: createEventId(recordKey), eventType: 'grade.created',
      detectedAt: '2026-10-19T00:00:00.000Z' }]
    f.readOutboxJobs = async () => [{ jobId: 'digest-opaque', state: 'sent', receiptCount: 1, receiptIds: [23] }]
    const result = await runMeshDeliveryCheck(f)
    expect(result.counts).toMatchObject({ eventCoveredReceipts: 5, uniqueTelegramMessages: 1 })
  })
})

function createEventId(value) { return `${value.slice(0, 63)}${value.at(-1) === 'f' ? 'e' : 'f'}` }
