// @vitest-environment jsdom
// @see ../../docs/modules/families/access-and-state.md#access-diagnostics
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ uid: 'device', writes: [] as Array<{ path: string; data: Record<string, unknown> }> }))
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: state.uid } }) }))
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }), serverTimestamp: () => 'SERVER', setDoc: async (ref: { path: string }, data: Record<string, unknown>) => { state.writes.push({ path: ref.path, data }) } }))
import { configureRoleDiagnostics, reportRoleProjection } from './roleDiagnostics'
const owner = { familyId: 'family', childId: 'child' }
const session = { personId: 'parent', deviceUid: 'device', linkToken: 'secret-never-transmitted' }
const stops: Array<() => void> = []
function configure(until = Date.now() + 60000) { const stop = configureRoleDiagnostics(session, 'family', { active: true, role: 'parent', childIds: ['child'], accessDiagnosticsUntil: { toMillis: () => until } }, 'parent'); stops.push(stop); return stop }
beforeEach(() => { state.uid = 'device'; state.writes = []; history.replaceState(null, '', '/#/days/secret-resource') })
afterEach(() => stops.splice(0).forEach((stop) => stop()))
describe('bounded role projection measurements', () => {
  it('does nothing without an operator-enabled window', () => { reportRoleProjection(owner, true, true); expect(state.writes).toEqual([]) })
  it('deduplicates eight cards and records the actual wrong projection without changing it', () => {
    configure(); for (let i = 0; i < 8; i++) reportRoleProjection(owner, false, false)
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0].data).toMatchObject({ memberRole: 'parent', renderedRole: 'student', hasGuide: false, surface: 'days' })
    expect(JSON.stringify(state.writes)).not.toContain('secret-')
  })
  it('records guide arrival separately, without repeated writes for the remaining cards', () => {
    configure(); reportRoleProjection(owner, true, false); reportRoleProjection(owner, true, true); reportRoleProjection(owner, true, true)
    expect(state.writes).toHaveLength(2); expect(state.writes[1].data.hasGuide).toBe(true)
  })
  it('does not send a foreign child, a replaced auth device or an expired window', () => {
    configure(); reportRoleProjection({ familyId: 'family', childId: 'foreign' }, true, true)
    state.uid = 'other'; reportRoleProjection(owner, true, true); state.uid = 'device'
    configure(Date.now() - 1); stops.splice(0).forEach((stop) => stop()); reportRoleProjection(owner, true, true)
    expect(state.writes).toEqual([])
  })
  it('does not let an old cleanup remove a replacement scope', () => {
    const old = configure(); configure(); old(); reportRoleProjection(owner, true, true)
    expect(state.writes).toHaveLength(1)
  })
  it('measures an already open card when its existing member snapshot enables the window', () => {
    const old = configureRoleDiagnostics(session, 'family', { active: true, role: 'parent', childIds: ['child'] }, 'parent')
    stops.push(old)
    reportRoleProjection(owner, false, false)
    expect(state.writes).toHaveLength(0)
    configure(); old()
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0].data.renderedRole).toBe('student')
  })
})
