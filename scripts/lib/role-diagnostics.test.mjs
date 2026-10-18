// @see ../../docs/modules/families/access-and-state.md#access-diagnostics
import { describe, expect, it } from 'vitest'
import { roleDiagnostics } from './role-diagnostics.mjs'
function fixture() {
  const registry = { people: { adult: { familyId: 'family', role: 'parent' } } }
  let data = { active: true, role: 'parent' }; const writes = []
  const db = { doc: (path) => ({ get: async () => ({ exists: true, data: () => data }), update: async (patch) => { writes.push({ path, patch }); data = { ...data, ...patch } } }) }
  return { registry, db, writes }
}
describe('operator role diagnostic window', () => {
  it('changes only the diagnostic expiry and confirms it by readback', async () => {
    const f = fixture(); const result = await roleDiagnostics(f.db, f.registry, 'adult', 'start', 30)
    expect(result.verified).toBe(true); expect(f.writes).toHaveLength(1)
    expect(f.writes[0].path).toBe('families/family/members/adult')
    expect(Object.keys(f.writes[0].patch)).toEqual(['accessDiagnosticsUntil'])
  })
  it('rejects unknown people and an unbounded window before writing', async () => {
    const f = fixture()
    await expect(roleDiagnostics(f.db, f.registry, 'foreign', 'start')).rejects.toThrow()
    await expect(roleDiagnostics(f.db, f.registry, 'adult', 'start', 120)).rejects.toThrow()
    expect(f.writes).toEqual([])
  })
})
