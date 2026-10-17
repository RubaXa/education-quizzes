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
      partialObservations: 0, observedRecords: 1, uncoveredChildren: 0, partialScopes: [], blockedReasons: {} })
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
})
