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
})
