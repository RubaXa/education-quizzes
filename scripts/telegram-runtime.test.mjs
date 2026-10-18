import { describe, expect, it } from 'vitest'
import { main } from './telegram-runtime.mjs'

describe('telegram runtime operator commands', () => {
  it('runs source-check in read-only mode and emits aggregate trace data only', async () => {
    let terminated = false
    const output = []
    const telemetry = {
      async trace(_operation, work) { return work() },
      span(_operation, work) { return work() },
      count() {},
      current() { return { traceId: 'a'.repeat(32) } },
      snapshot() { return { spanCount: 2, counters: {}, spans: {}, exporterErrors: 0 } },
    }
    const exitCode = await main(['source-check'], { root: '/tmp/project', env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'education-prod' },
      db: { async terminate() { terminated = true } }, keepOpen: false, telemetry, legacyCodec: {},
      inventory: { async enumerate() { return { complete: true, families: [{ familyId: 'private-family' }],
        registeredChildren: [{ familyId: 'private-family', childId: 'private-child', meshStatus: 'eligible' }],
        sourceAccounts: [{ accountId: 'private-account' }], failures: [],
        scopes: [{ scope: { source: 'mesh', familyId: 'private-family', childId: 'private-child' } }] } } },
      meshSource: { async observe() { return { completeness: 'complete', familyId: 'private-family', childId: 'private-child',
        records: [{ fields: { grade: '5' } }] } } },
      write(value) { output.push(value) },
    })
    const result = JSON.parse(output[0])
    expect(exitCode).toBe(0)
    expect(terminated).toBe(true)
    expect(result).toMatchObject({ coverageComplete: true, writes: 0, sends: 0, meshScopes: 1, observedRecords: 1,
      telemetry: { traceId: 'a'.repeat(32), spanCount: 2 } })
    expect(JSON.stringify(result)).not.toContain('private-family')
    expect(JSON.stringify(result)).not.toContain('private-account')
    expect(JSON.stringify(result)).not.toContain('grade')
  })

  it('offers an opt-in schedule date diagnostic through the shared source-check path', async () => {
    const output = []
    let observed = 0
    const telemetry = { async trace(_name, work) { return work() }, span(_name, work) { return work() },
      current() { return { traceId: 'b'.repeat(32) } }, snapshot() { return { spanCount: 1, counters: {}, spans: {}, exporterErrors: 0 } } }
    const exitCode = await main(['source-check', '--diagnose-schedule-dates', '--date', '2026-10-17'], { root: '/tmp/project',
      env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'education-prod' }, db: { async terminate() {} }, telemetry,
      inventory: { async enumerate() { return { complete: true, families: [{ familyId: 'f' }],
        registeredChildren: [{ familyId: 'f', childId: 'c', hasMeshIdentity: true, hasMeshAccount: true }], sourceAccounts: [], failures: [],
        scopes: [{ scope: { source: 'mesh', familyId: 'f', childId: 'c', sourceAccountId: 'a', sourcePersonId: 'p', kind: 'schedule', date: '2026-10-17' } },
          { scope: { source: 'mesh', familyId: 'f', childId: 'c', sourceAccountId: 'a', sourcePersonId: 'p', kind: 'schedule', date: '2026-10-18' } }] } } },
      meshSource: { async observe() { observed += 1; return { completeness: 'complete', familyId: 'f', childId: 'c', records: [], scheduleDateDiagnostics: [] } } },
      write(value) { output.push(value) },
    })
    const result = JSON.parse(output[0])
    expect(exitCode).toBe(1)
    expect(observed).toBe(1)
    expect(result).toMatchObject({ meshScopes: 2, completeObservations: 1, coverageComplete: false,
      diagnosticOnly: true, diagnosticScopeCount: 1, unobservedScopes: 1, scheduleDateDiagnostics: [] })
  })

  it('rejects impossible requested dates before connecting to sources', async () => {
    const output = []
    const exitCode = await main(['source-check', '--diagnose-schedule-dates', '--date', '2026-02-30'], {
      write(value) { output.push(value) },
    })
    expect(exitCode).toBe(2)
    expect(JSON.parse(output[0])).toMatchObject({ code: 'usage' })
  })

  it('exposes an aggregate-only upload-check command without writes or sends', async () => {
    const output = []
    let terminated = false
    const scope = { familyId: 'private-family', childId: 'private-child', kind: 'upload', dayToken: 'private-day', recordId: 'private-upload' }
    const record = { recordKey: 'a'.repeat(64), kind: 'upload', eventType: 'upload.confirmed', semanticHash: 'b'.repeat(64),
      occurredAt: '2026-10-18T06:37:55.000Z', fields: { childName: 'Private Name', subject: 'Math', title: 'Private title' } }
    const exitCode = await main(['upload-check', '--since', '2026-10-18T00:00:00Z'], {
      root: '/tmp/project', env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'education-prod' }, db: { async terminate() { terminated = true } },
      inventory: { async enumerate() { return { complete: true, failures: [], families: [], scopes: [{ source: 'firestore', scope }] } } },
      discoveryStore: { async prepare(inventory) { return { ...inventory, scopes: [{ source: 'firestore', scope, origin: 'live' }] } } },
      source: { scopeKey: () => 'opaque-scope', async inspectUpload() { return { completeness: 'complete', state: 'confirmed', occurredAt: record.occurredAt } },
        async observe() { return { completeness: 'complete', scopeKey: 'opaque-scope', familyId: scope.familyId, childId: scope.childId, records: [record] } } },
      readCheckpoint: async () => ({ baseline: { complete: true, observationSequence: 1, sourceProjectionVersion: 2, records: [] } }),
      readLedgerEventsByRecord: async () => [], readOutboxJobs: async () => [],
      write(value) { output.push(value) },
    })
    const result = JSON.parse(output[0])
    expect(exitCode).toBe(0)
    expect(terminated).toBe(true)
    expect(result).toMatchObject({ diagnosticOnly: true, writes: 0, sends: 0, coverageComplete: false, diagnosticComplete: true,
      counts: { recentConfirmed: 1, wouldEmit: 1, ledgerMissing: 1, outboxAbsent: 1 } })
    expect(JSON.stringify(result)).not.toMatch(/private-family|private-child|private-day|private-upload|Private Name|Private title|Math/)
  })

  it('follows only a proven grouped upload receipt and excludes the duplicate digest query row', async () => {
    for (const proven of [true, false]) {
      const output = []
      const scope = { familyId: 'family-a', childId: 'child-a', kind: 'upload', dayToken: 'day-a', recordId: 'upload-a' }
      const record = { recordKey: 'a'.repeat(64), kind: 'upload', eventType: 'upload.confirmed',
        occurredAt: '2026-10-18T08:00:00.000Z', fields: { subject: 'Математика', title: 'Задание №3' } }
      const digestId = `digest_${'b'.repeat(64)}`
      const digest = { isDigest: true, state: 'sent', partReceipts: [{ messageId: 42 }], eventJobIds: proven ? ['job-a'] : ['other-job'] }
      const sourceDoc = { id: 'job-a', data: () => ({ state: 'grouped', groupedInto: digestId }) }
      const digestDoc = { id: digestId, data: () => digest }
      const query = { where() { return this }, select() { return this }, get: async () => ({ docs: [sourceDoc, digestDoc] }) }
      const code = await main(['upload-check', '--since', '2026-10-18T00:00:00Z'], {
        root: '/tmp/project', env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'education-prod' },
        db: { collection: () => query, doc: path => ({ path }), terminate: async () => {},
          getAll: async (ref, options) => {
            expect(ref.path).toBe(`telegramNotificationOutbox/${digestId}`)
            expect(options.fieldMask).toContain('eventJobIds')
            return [{ exists: true, data: () => digest }]
          } },
        inventory: { enumerate: async () => ({ complete: true, failures: [], families: [], scopes: [] }) },
        discoveryStore: { prepare: async () => ({ scopes: [{ scope, origin: 'live' }] }) },
        source: { scopeKey: () => 'opaque', inspectUpload: async () => ({ completeness: 'complete', state: 'confirmed', occurredAt: record.occurredAt }),
          observe: async () => ({ completeness: 'complete', records: [record] }) },
        readCheckpoint: async () => ({ baseline: { records: [record], sourceProjectionVersion: 2 } }),
        readLedgerEventsByRecord: async () => [{ eventId: 'event-a' }], write: text => output.push(JSON.parse(text)),
      })
      expect(code).toBe(0)
      expect(output[0].counts.outboxSent).toBe(proven ? 1 : 0)
      expect(output[0].counts.sentReceipts).toBe(proven ? 1 : 0)
      expect(JSON.stringify(output)).not.toMatch(/job-a|other-job|digest_/)
    }
  })

  it('exposes a read-only aggregate review-check command', async () => {
    const output = []
    let terminated = false
    const scope = { familyId: 'private-family', childId: 'private-child', kind: 'progress', dayToken: 'private-day', recordId: 'private-task' }
    const exitCode = await main(['review-check', '--since', '2026-10-18T00:00:00Z'], {
      root: '/tmp/project', env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'education-prod' }, db: { async terminate() { terminated = true } },
      inventory: { async enumerate() { return { complete: true, failures: [], families: [], scopes: [{ source: 'firestore', scope }] } } },
      discoveryStore: { async prepare(inventory) { return { ...inventory, scopes: [{ source: 'firestore', scope, origin: 'live' }] } } },
      source: { scopeKey: () => 'opaque-scope', async inspectReview() { return { completeness: 'complete', state: 'verified', checkedAt: '2026-10-18T08:00:00Z' } },
        async observe() { return { completeness: 'complete', familyId: scope.familyId, childId: scope.childId,
          records: [{ recordKey: 'a'.repeat(64), kind: 'review', eventType: 'review.changed', semanticHash: 'b'.repeat(64),
            fields: { subject: 'Math', title: 'Private title', status: 'verified' } }] } } },
      readCheckpoint: async () => ({ baseline: { records: [] } }),
      readLedgerEventsByRecord: async () => [{ eventId: 'event-private', detectedAt: '2026-10-18T08:00:00Z',
        sourceRevision: 'revision-private', fields: { status: 'verified', subject: 'Math' } }], readOutboxJobs: async () => [],
      write(value) { output.push(value) },
    })
    const result = JSON.parse(output[0])
    expect(exitCode).toBe(0)
    expect(terminated).toBe(true)
    expect(result).toMatchObject({ diagnosticOnly: true, writes: 0, sends: 0, coverageComplete: false,
      diagnosticComplete: true, counts: { reviewScopes: 1, recentReviewed: 1, missingSubjectOrTitle: 0, ledgerPresent: 1, outboxAbsent: 1 } })
    expect(JSON.stringify(result)).not.toMatch(/private-family|private-child|private-day|private-task|Private title|Math/)
  })
})
