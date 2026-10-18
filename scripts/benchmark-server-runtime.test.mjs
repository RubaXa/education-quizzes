import { describe, expect, it } from 'vitest'
import { runServerRuntimeBenchmark } from './benchmark-server-runtime.mjs'

describe('synthetic shared server runtime benchmark', () => {
  it('runs real graph/coordinator/pipeline/memory-outbox code and reports measured schema', async () => {
    const report = await runServerRuntimeBenchmark({ familyCounts: [1], childrenPerFamily: 2,
      densityScenarios: [], injectTransientError: false, duplicateSignals: 2 })
    expect(report).toMatchObject({ schemaVersion: 1, benchmark: 'education.server-runtime.synthetic',
      measurementNotes: { billing: 'not_measured', caps: 'none', network: 'no_real_sdk_or_network' } })
    expect(report.source).toMatchObject({ baseCommit: expect.any(String), dirty: expect.any(Boolean),
      sha256: { 'packages/education-runtime/family-graph.mjs': expect.any(String),
        'scripts/benchmark-server-runtime.mjs': expect.any(String) } })
    const scenario = report.scenarios[0]
    expect(scenario).toMatchObject({ families: 1, children: 2, scopes: 2, completed: true,
      assertions: { allScopesUpdated: true, outboxExactlyOnce: true, outboxDrained: true },
      source: { updatedScopes: 2, retryRecoveredTransientErrors: 0 },
      fairness: { totalScopes: 2, updatedScopes: 2, coverage: 1 },
      telegramMemoryOutbox: { events: 2, jobs: 2, deliveredJobs: 2 },
      firestoreSynthetic: { queryCalls: expect.any(Number), documentsReturned: expect.any(Number), billedReads: 'not_measured' } })
    expect(scenario.durations.pipeline).toMatchObject({ count: expect.any(Number), p50Ms: expect.any(Number), p95Ms: expect.any(Number) })
    expect(scenario.source.cache).toEqual({ hits: 0, misses: scenario.source.observeCalls,
      policy: 'source_adapter_does_not_cache_observations' })
  })

  it('rejects invalid requested family sizes instead of silently truncating', async () => {
    await expect(runServerRuntimeBenchmark({ familyCounts: [0] })).rejects.toThrow('familyCounts')
    await expect(runServerRuntimeBenchmark({ familyCounts: [Number.MAX_SAFE_INTEGER + 1] })).rejects.toThrow('familyCounts')
    await expect(runServerRuntimeBenchmark({ densityScenarios: [{ families: 1, scopesPerChild: 0 }] })).rejects.toThrow('densityScenarios')
  })

  it('recovers one synthetic source failure while still draining each scope and job once', async () => {
    const report = await runServerRuntimeBenchmark({ familyCounts: [1], childrenPerFamily: 1,
      densityScenarios: [], injectTransientError: true, duplicateSignals: 3 })
    const scenario = report.scenarios[0]
    expect(scenario).toMatchObject({ completed: true, transientSourceErrors: 1,
      assertions: { allScopesUpdated: true, outboxExactlyOnce: true, outboxDrained: true },
      source: { retryRecoveredTransientErrors: 1 },
      telegramMemoryOutbox: { events: 1, duplicateAccepts: 0, jobs: 1, deliveredJobs: 1, undeliveredJobs: 0 },
      fairness: { coverage: 1 } })
  })

  it('covers every synthetic schedule/homework/grade scope in a dense family graph', async () => {
    const report = await runServerRuntimeBenchmark({ familyCounts: [1], childrenPerFamily: 2,
      densityScenarios: [{ families: 1, scopesPerChild: 85 }], injectTransientError: false, duplicateSignals: 1 })
    const scenario = report.scenarios[1]
    expect(scenario).toMatchObject({ scenarioType: 'scope_density', families: 1, children: 2,
      scopesPerChild: 85, scopeUnits: 170, scopes: 170, completed: true,
      assertions: { allScopesUpdated: true, outboxExactlyOnce: true, outboxDrained: true, allScopeKindsCovered: true },
      fairness: { coverage: 1, queueCoverageByScopeKind: {
        'schedule.changed': { expected: 84, accepted: 84 },
        'homework.changed': { expected: 84, accepted: 84 },
        'grade.changed': { expected: 2, accepted: 2 },
      } } })
  }, 30_000)
})
