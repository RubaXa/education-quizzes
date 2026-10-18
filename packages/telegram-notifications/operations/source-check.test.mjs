import { describe, expect, it } from 'vitest'
import { runMeshSourceCheck } from './source-check.mjs'

describe('read-only Mesh source check', () => {
  it('reports aggregate completeness and never includes source records or identities', async () => {
    const result = await runMeshSourceCheck({
      inventory: { enumerate: async () => ({ complete: true, families: [{ familyId: 'secret-family' }],
        registeredChildren: [{ familyId: 'secret-family', childId: 'secret-child', hasMeshIdentity: true, hasMeshAccount: true }],
        sourceAccounts: [{ accountId: 'secret-account' }], failures: [],
        scopes: [{ scope: { source: 'mesh', familyId: 'secret-family', childId: 'secret-child', sourceAccountId: 'secret-account', sourcePersonId: 'secret-person', kind: 'grades', periodKey: '2026-10-17', subjectId: 'math' } }] }) },
      meshSource: { observe: async () => ({ completeness: 'complete', familyId: 'secret-family', childId: 'secret-child',
        records: [{ fields: { value: 'private grade' } }] }) },
    })
    expect(result).toEqual({ schemaVersion: 1, status: 'complete', coverageComplete: true, writes: 0, sends: 0,
      families: 1, registeredChildren: 1, meshAccounts: 1, meshScopes: 1, completeObservations: 1,
      partialObservations: 0, observedRecords: 1, excludedCalendarEvents: 0,
      uncoveredChildren: 0, partialScopes: [], blockedReasons: {} })
    expect(JSON.stringify(result)).not.toContain('secret-')
    expect(JSON.stringify(result)).not.toContain('private grade')
  })

  it('counts partial scopes and sanitizes unknown errors into a safe blocker', async () => {
    const result = await runMeshSourceCheck({
      inventory: { enumerate: async () => ({ complete: false, families: [], registeredChildren: [], sourceAccounts: [],
        failures: [{ code: 'private message with ids' }], scopes: [{ scope: { source: 'mesh', familyId: 'secret-family', childId: 'secret-child', kind: 'grades' } }] }) },
      meshSource: { observe: async () => ({ completeness: 'partial', errorCode: 'mesh_incomplete', diagnosticCode: 'invalid_mark_record' }) },
    })
    expect(result.status).toBe('incomplete')
    expect(result.coverageComplete).toBe(false)
    expect(result.partialObservations).toBe(1)
    expect(result.blockedReasons).toEqual({ mesh_incomplete: 1, mesh_unavailable: 1 })
    expect(result.partialScopes).toHaveLength(1)
    expect(result.partialScopes[0]).toMatchObject({ kind: 'grades', reasonCode: 'invalid_mark_record' })
    expect(result.partialScopes[0].scopeDigest).toMatch(/^[a-f0-9]{16}$/)
    expect(JSON.stringify(result)).not.toContain('secret-')
  })

  it('does not call empty inventory complete when registered Mesh children have no scopes', async () => {
    const result = await runMeshSourceCheck({
      inventory: { enumerate: async () => ({ complete: true, families: [{ familyId: 'f' }],
        registeredChildren: [{ familyId: 'f', childId: 'c', hasMeshIdentity: true, hasMeshAccount: false }],
        sourceAccounts: [], failures: [], scopes: [] }) },
      meshSource: { observe: async () => null },
    })
    expect(result.coverageComplete).toBe(false)
    expect(result.uncoveredChildren).toBe(1)
    expect(result.blockedReasons).toEqual({ mesh_scope_unavailable: 1 })
  })

  it('includes every safe schedule date mismatch while retaining all-scope coverage counts', async () => {
    const scopes = Array.from({ length: 3 }, (_, index) => ({ source: 'mesh', familyId: 'f', childId: 'c',
      sourceAccountId: `account-${index}`, sourcePersonId: 'person', kind: 'schedule', date: '2026-10-17' }))
    const result = await runMeshSourceCheck({ diagnoseScheduleDates: true,
      inventory: { enumerate: async () => ({ complete: true, families: [{ familyId: 'f' }],
        registeredChildren: [{ familyId: 'f', childId: 'c', hasMeshIdentity: true, hasMeshAccount: true }],
        sourceAccounts: [], failures: [], scopes: scopes.map((scope) => ({ scope })) }) },
      meshSource: { observe: async (scope) => ({ completeness: 'partial', errorCode: 'mesh_incomplete',
        diagnosticCode: 'schedule_date_mismatch', scheduleDateDiagnostics: [
          { requestedDate: scope.date, startDate: '2026-10-18', startsAt: '2026-10-18T09:00:00+03:00',
            finishesAt: '2026-10-18T09:45:00+03:00', eventClass: 'lesson', source: 'PLAN', hasSubject: false, private: 'must not escape' },
          { requestedDate: scope.date, startDate: '2026-10-16', startsAt: '2026-10-16T23:00:00Z',
            finishesAt: '2026-10-17T00:00:00Z', eventClass: 'calendar', source: 'OLYMPIAD' },
        ] }) } })
    expect(result).toMatchObject({ status: 'incomplete', meshScopes: 3, partialObservations: 3,
      scheduleDateDiagnostics: expect.arrayContaining([
        expect.objectContaining({ requestedDate: '2026-10-17', startDate: '2026-10-18', startsAt: '2026-10-18T09:00:00+03:00', eventClass: 'lesson', source: 'PLAN', hasSubject: false }),
        expect.objectContaining({ requestedDate: '2026-10-17', startDate: '2026-10-16', eventClass: 'calendar', source: 'OLYMPIAD' }),
      ]) })
    expect(result.scheduleDateDiagnostics).toHaveLength(6)
    expect(JSON.stringify(result)).not.toContain('must not escape')
    expect(JSON.stringify(result)).not.toContain('account-')
  })

  it('reobserves requested schedule dates and reports omitted scopes without claiming full coverage', async () => {
    let observed = 0
    const result = await runMeshSourceCheck({ diagnoseScheduleDates: true, scheduleDates: ['2026-10-13', '2026-10-14', '2026-10-15'],
      inventory: { enumerate: async () => ({ complete: true, families: [{ familyId: 'f' }],
        registeredChildren: [{ familyId: 'f', childId: 'c', hasMeshIdentity: true, hasMeshAccount: true }], sourceAccounts: [], failures: [],
        scopes: ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map((date) => ({ scope: {
          source: 'mesh', familyId: 'f', childId: 'c', sourceAccountId: 'a', sourcePersonId: 'p', kind: 'schedule', date,
        } })) }) },
      meshSource: { observe: async (scope) => { observed += 1; return { completeness: 'complete', familyId: 'f', childId: 'c', records: [],
        scheduleDateDiagnostics: scope.date === '2026-10-13' ? [{ startDate: '2026-10-12', startsAt: '2026-10-12T09:00:00+03:00',
          finishesAt: '2026-10-15T21:30:00+03:00', source: 'OLYMPIAD', eventClass: 'calendar', eventDigest: 'a'.repeat(64) }] : [] } } },
    })
    expect(observed).toBe(3)
    expect(result).toMatchObject({ coverageComplete: false, diagnosticOnly: true, diagnosticScopeCount: 3,
      allFamilies: 1, inventoryScopes: 4, selectedScopes: 3, unobservedScopes: 1,
      requestedScheduleDates: ['2026-10-13', '2026-10-14', '2026-10-15'] })
    expect(result.scheduleDateDiagnostics[0]).toMatchObject({ startsAt: '2026-10-12T09:00:00+03:00',
      finishesAt: '2026-10-15T21:30:00+03:00', eventDigest: 'a'.repeat(64) })
  })

  it('retains mismatch metadata on complete observations and aggregates confirmed calendar exclusions', async () => {
    const dates = ['2026-10-13', '2026-10-14', '2026-10-15']
    const result = await runMeshSourceCheck({ diagnoseScheduleDates: true, scheduleDates: dates,
      inventory: { enumerate: async () => ({ complete: true, families: [{ familyId: 'f' }],
        registeredChildren: [{ familyId: 'f', childId: 'c', hasMeshIdentity: true, hasMeshAccount: true }], sourceAccounts: [], failures: [],
        scopes: dates.map((date) => ({ scope: { source: 'mesh', familyId: 'f', childId: 'c', sourceAccountId: 'a',
          sourcePersonId: 'p', kind: 'schedule', date } })) }) },
      meshSource: { observe: async (scope) => ({ completeness: 'complete', familyId: 'f', childId: 'c', records: [], excludedCalendarEvents: 1,
        scheduleDateDiagnostics: [{ requestedDate: scope.date, startDate: '2026-10-12', startsAt: '2026-10-12T09:00:00+03:00',
          finishesAt: '2026-10-15T21:30:00+03:00', eventClass: 'calendar', source: 'OLYMPIAD', hasSubject: false,
          hasLessonType: false, hasHomework: false, eventDigest: 'e'.repeat(64) }] }) } })
    expect(result).toMatchObject({ coverageComplete: false, meshScopes: 3, completeObservations: 3,
      excludedCalendarEvents: 3, scheduleDateDiagnostics: expect.any(Array) })
    expect(result.scheduleDateDiagnostics.map(({ requestedDate }) => requestedDate).sort()).toEqual([...dates].sort())
    expect(result.scheduleDateDiagnostics.every(({ eventDigest }) => eventDigest === 'e'.repeat(64))).toBe(true)
  })

  it('rejects impossible source timestamps supplied by a downstream observation', async () => {
    const result = await runMeshSourceCheck({ diagnoseScheduleDates: true,
      inventory: { enumerate: async () => ({ complete: true, families: [], registeredChildren: [], sourceAccounts: [], failures: [],
        scopes: [{ scope: { source: 'mesh', familyId: 'f', childId: 'c', sourceAccountId: 'a', sourcePersonId: 'p',
          kind: 'schedule', date: '2026-02-28' } }] }) },
      meshSource: { observe: async () => ({ completeness: 'partial', errorCode: 'mesh_incomplete', diagnosticCode: 'schedule_date_mismatch',
        scheduleDateDiagnostics: [{ requestedDate: '2026-02-28', startDate: '2026-02-30',
          startsAt: '2026-02-30T09:00:00Z', finishesAt: '2026-03-02T10:00:00Z', eventClass: 'lesson', source: 'PLAN' }] }) } })
    expect(result.scheduleDateDiagnostics[0]).toMatchObject({ startsAt: null, finishesAt: '2026-03-02T10:00:00Z' })
  })
})
