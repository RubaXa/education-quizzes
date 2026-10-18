import { describe, expect, it, vi } from 'vitest'
import { runUploadCheck, parseUploadCheckArgs } from './upload-check.mjs'

const scope = { familyId: 'family-private', childId: 'child-private', kind: 'upload', dayToken: 'day-private', recordId: 'upload-private' }
const record = { recordKey: 'a'.repeat(64), kind: 'upload', eventType: 'upload.confirmed',
  semanticHash: 'b'.repeat(64), occurredAt: '2026-10-18T06:37:55.000Z',
  fields: { childName: 'Имя', subject: 'Математика', title: 'Задание', occurredLabel: 'Задание к 2026-10-22' } }

describe('upload-check', () => {
  it('parses an optional bounded observation window', () => {
    expect(parseUploadCheckArgs([], new Date('2026-10-18T12:00:00Z'))).toEqual({ since: '2026-10-15T12:00:00.000Z' })
    expect(parseUploadCheckArgs(['--since', '2026-10-18T00:00:00Z'])).toEqual({ since: '2026-10-18T00:00:00.000Z' })
    expect(parseUploadCheckArgs(['--since', 'not-a-date'])).toBeNull()
    expect(parseUploadCheckArgs(['--since', '2026-02-30T00:00:00Z'])).toBeNull()
    expect(parseUploadCheckArgs(['--apply'])).toBeNull()
  })

  it('reports safe aggregate state for live, recent uploads and proves missing ledger/outbox without writes', async () => {
    const readCheckpoint = vi.fn(async () => ({ sequence: 2, baseline: { complete: true, observationSequence: 2,
      sourceProjectionVersion: 2, records: [] } }))
    const readLedgerEventsByRecord = vi.fn(async () => [])
    const readOutboxJobs = vi.fn(async () => [])
    const result = await runUploadCheck({
      inventory: { async enumerate() { return { complete: true, failures: [], families: [], scopes: [{ source: 'firestore', scope, origin: 'live' }] } } },
      discoveryStore: { async prepare(inventory) { return { ...inventory, scopes: [{ source: 'firestore', scope, origin: 'live' }] } } },
      source: { scopeKey: () => 'opaque-scope-key', async inspectUpload() { return { completeness: 'complete', state: 'confirmed', occurredAt: record.occurredAt } },
        async observe() { return { source: 'firestore', completeness: 'complete', scopeKey: 'opaque-scope-key', familyId: scope.familyId, childId: scope.childId, records: [record] } } },
      readCheckpoint, readLedgerEventsByRecord, readOutboxJobs, since: '2026-10-18T00:00:00Z', clock: () => new Date('2026-10-18T07:00:00Z'),
    })
    expect(result).toMatchObject({ diagnosticOnly: true, writes: 0, sends: 0, coverageComplete: false, diagnosticComplete: true,
      counts: { uploadScopes: 1, recentConfirmed: 1, liveOrigin: 1, checkpointProjectionV2: 1, wouldEmit: 1, ledgerMissing: 1, outboxAbsent: 1 } })
    expect(JSON.stringify(result)).not.toMatch(/family-private|child-private|day-private|upload-private|Математика|Задание|Имя/)
    expect(readCheckpoint).toHaveBeenCalledWith('opaque-scope-key')
    expect(readLedgerEventsByRecord).toHaveBeenCalledTimes(1)
    expect(readOutboxJobs).not.toHaveBeenCalled()
  })

  it('keeps legacy bootstrap empty baselines quiet while allowing a later version-two baseline transition', async () => {
    for (const baseline of [null, { complete: true, observationSequence: 1, records: [] }]) {
      const result = await runUploadCheck({
        inventory: { async enumerate() { return { complete: true, failures: [], families: [], scopes: [{ source: 'firestore', scope }] } } },
        discoveryStore: { async prepare(inventory) { return { ...inventory, scopes: [{ source: 'firestore', scope, origin: 'bootstrap' }] } } },
        source: { scopeKey: () => 'opaque', async inspectUpload() { return { completeness: 'complete', state: 'confirmed', occurredAt: record.occurredAt } },
          async observe() { return { completeness: 'complete', records: [record] } } },
        readCheckpoint: async () => ({ baseline }), readLedgerEventsByRecord: async () => [], readOutboxJobs: async () => [],
        since: '2026-10-18T00:00:00Z',
      })
      expect(result.counts.wouldEmit).toBe(0)
    }
    const result = await runUploadCheck({
      inventory: { async enumerate() { return { complete: true, failures: [], families: [], scopes: [{ source: 'firestore', scope }] } } },
      discoveryStore: { async prepare(inventory) { return { ...inventory, scopes: [{ source: 'firestore', scope, origin: 'bootstrap' }] } } },
      source: { scopeKey: () => 'opaque', async inspectUpload() { return { completeness: 'complete', state: 'confirmed', occurredAt: record.occurredAt } },
        async observe() { return { completeness: 'complete', records: [record] } } },
      readCheckpoint: async () => ({ baseline: { complete: true, observationSequence: 1, sourceProjectionVersion: 2, records: [] } }),
      readLedgerEventsByRecord: async () => [], readOutboxJobs: async () => [], since: '2026-10-18T00:00:00Z',
    })
    expect(result.counts.wouldEmit).toBe(1)
  })

  it('checks actual ledger and sent receipt state for an upload already in the checkpoint', async () => {
    const result = await runUploadCheck({
      inventory: { async enumerate() { return { complete: true, failures: [], families: [], scopes: [{ source: 'firestore', scope }] } } },
      discoveryStore: { async prepare(inventory) { return { ...inventory, scopes: [{ source: 'firestore', scope, origin: 'live' }] } } },
      source: { scopeKey: () => 'opaque', async inspectUpload() { return { completeness: 'complete', state: 'confirmed', occurredAt: record.occurredAt } },
        async observe() { return { completeness: 'complete', records: [record] } } },
      readCheckpoint: async () => ({ baseline: { complete: true, observationSequence: 4, sourceProjectionVersion: 2, records: [record] } }),
      readLedgerEventsByRecord: async () => [{ eventId: 'internal-id' }],
      readOutboxJobs: async () => [{ state: 'sent', receiptCount: 1 }], since: '2026-10-18T00:00:00Z',
    })
    expect(result.counts).toMatchObject({ checkpointHasUpload: 1, wouldEmit: 0, ledgerPresent: 1, outboxSent: 1, sentReceipts: 1 })
    expect(JSON.stringify(result)).not.toContain('internal-id')
  })

  it('does not claim long-title or unknown-field records would emit through SourcePipeline', async () => {
    const rejected = [
      { ...record, fields: { ...record.fields, title: 'x'.repeat(501) } },
      { ...record, fields: { ...record.fields, internalNote: 'private' } },
    ]
    for (const unsafeRecord of rejected) {
      const result = await runUploadCheck({
        inventory: { async enumerate() { return { complete: true, failures: [], families: [], scopes: [{ source: 'firestore', scope }] } } },
        discoveryStore: { async prepare(inventory) { return { ...inventory, scopes: [{ source: 'firestore', scope, origin: 'live' }] } } },
        source: { scopeKey: () => 'opaque', async inspectUpload() { return { completeness: 'complete', state: 'confirmed', occurredAt: record.occurredAt } },
          async observe() { return { completeness: 'complete', records: [unsafeRecord] } } },
        readCheckpoint: async () => null, readLedgerEventsByRecord: async () => [], readOutboxJobs: async () => [],
        since: '2026-10-18T00:00:00Z',
      })
      expect(result.counts).toMatchObject({ pipelineRejected: 1, wouldEmit: 0 })
      expect(result.diagnosticComplete).toBe(false)
    }
  })
})
