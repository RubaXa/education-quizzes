// @vitest-environment jsdom
/** @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const parentLink = 'p'.repeat(43), childLink = 's'.repeat(43)
const scene = vi.hoisted(() => ({ reads: [] as string[], writes: 0, deviceLink: 's'.repeat(43), deviceReadGate: null as Promise<void> | null, deviceFromCache: false, failure: null as string | null }))
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'same-browser' }, authStateReady: async () => {} }), signInAnonymously: vi.fn() }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  serverTimestamp: () => null,
  setDoc: async (_ref: unknown, data: { linkToken: string }) => { scene.writes++; scene.deviceLink = data.linkToken },
  getDoc: async ({ path }: { path: string }) => {
    scene.reads.push(path)
    if (scene.failure) throw Object.assign(new Error('Injected IO failure'), { code: scene.failure })
    let value: object
    if (path.startsWith('deviceSessions/')) { if (scene.deviceReadGate) await scene.deviceReadGate; value = { linkToken: scene.deviceLink } }
    else if (path.startsWith('accessLinks/')) value = { active: true, personId: path.endsWith('p'.repeat(43)) ? 'parent' : 'child' }
    else if (path.startsWith('users/') && path.split('/').length === 2) value = { displayName: path.split('/')[1] }
    else if (path.includes('/members/')) value = { active: true, role: path.endsWith('/parent') ? 'parent' : 'student', childIds: ['learner'] }
    else if (path.includes('/shortcuts/')) value = { dashboardToken: path.startsWith('users/parent/') ? 'parent-calendar' : 'shared-calendar', dashboardTokens: { parent: 'parent-calendar', student: 'shared-calendar' } }
    else if (path.includes('/children/')) value = { displayName: 'Learner' }
    else throw new Error(`Unexpected ${path}`)
    return { exists: () => true, data: () => value, metadata: { fromCache: path.startsWith('deviceSessions/') && scene.deviceFromCache } }
  },
  getDocs: async () => ({ docs: [{ id: 'family' }] }),
}))

let api: typeof import('./personalAccess')
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { promise, resolve } }
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve() }
beforeEach(async () => {
  vi.resetModules(); localStorage.clear(); scene.reads = []; scene.writes = 0; scene.deviceLink = childLink; scene.deviceReadGate = null; scene.deviceFromCache = false; scene.failure = null
  api = await import('./personalAccess')
  api.rememberPersonalContext({ session: { personId: 'child', deviceUid: 'same-browser', linkToken: childLink }, profile: { personId: 'child', displayName: 'Learner', children: [
    { familyId: 'family', childId: 'learner', displayName: 'Learner', role: 'student', dashboardToken: 'shared-calendar', dashboardTokens: { student: 'shared-calendar', parent: 'parent-calendar' } },
  ] } })
})

describe('personal identity during a link redemption', () => {
  it('joins concurrent recovery consumers and never writes a device binding or redeems a link', async () => {
    const previous = api.readCachedPersonalContext()!.session
    scene.deviceLink = parentLink
    expect(await Promise.all([api.recoverPersonalContext(previous), api.recoverPersonalContext(previous)])).toEqual([true, true])
    expect(api.readCachedPersonalContext()?.session.personId).toBe('parent')
    expect(scene.reads.filter(path => path.startsWith('deviceSessions/'))).toHaveLength(1)
    expect(scene.writes).toBe(0)
  })
  it('does not treat an offline cached device binding as server authorization', async () => {
    const previous = api.readCachedPersonalContext()!.session
    scene.deviceLink = parentLink; scene.deviceFromCache = true
    await expect(api.recoverPersonalContext(previous)).rejects.toMatchObject({ code: 'unavailable' })
    expect(api.readCachedPersonalContext()?.session.personId).toBe('child')
    expect(scene.reads.some(path => path.startsWith('users/parent'))).toBe(false)
    expect(scene.writes).toBe(0)
  })
  it('retains the local context on a transient recovery failure and does not invent a parent role', async () => {
    scene.failure = 'unavailable'
    await expect(api.recoverPersonalContext(api.readCachedPersonalContext()!.session)).rejects.toMatchObject({ code: 'unavailable' })
    expect(api.readCachedPersonalContext()?.profile.children[0].role).toBe('student')
  })
  it('does not restore a replacement after the current session was revoked during its read', async () => {
    const previous = api.readCachedPersonalContext()!.session
    scene.deviceLink = parentLink
    const gate = deferred(); scene.deviceReadGate = gate.promise
    const recovery = api.recoverPersonalContext(previous)
    await flush(); api.clearPersonalSession(); gate.resolve()
    await recovery
    expect(api.readCachedPersonalContext()).toBeNull()
    expect(scene.writes).toBe(0)
  })
  it('prefers the saved sibling-tab identity even when no entry observer was mounted', async () => {
    const previous = api.readCachedPersonalContext()!
    localStorage.setItem('education-personal-context-v1', JSON.stringify({
      ...previous, session: { ...previous.session, personId: 'parent', linkToken: parentLink },
      profile: { ...previous.profile, personId: 'parent' },
    }))
    expect(() => api.currentEducationPersonId()).toThrow()
    expect(await api.restorePersonalSession()).toMatchObject({ personId: 'parent', linkToken: parentLink })
    expect(api.currentEducationPersonId()).toBe('parent')
  })
  it('adopts a profile changed in another tab instead of retaining the old active person', async () => {
    const previous = api.readCachedPersonalContext()!
    const parent = { session: { personId: 'parent', deviceUid: 'same-browser', linkToken: parentLink },
      profile: { ...previous.profile, personId: 'parent', children: previous.profile.children.map((child) => ({ ...child, role: 'parent', dashboardToken: 'parent-calendar' })) }, savedAt: Date.now() }
    const changed = vi.fn()
    // Subscribe before the simulated login in a sibling tab.
    const stop = api.watchPersonalContextChanges(changed)
    localStorage.setItem('education-personal-context-v1', JSON.stringify(parent))
    window.dispatchEvent(new StorageEvent('storage', { key: 'education-personal-context-v1' }))
    expect(changed).toHaveBeenCalledOnce()
    expect(() => api.currentEducationPersonId()).toThrow()
    expect((await api.restorePersonalContext())?.profile.children[0].role).toBe('parent')
    expect(api.currentEducationPersonId()).toBe('parent')
    expect(() => api.rememberPersonalContext(previous)).toThrow()
    stop()
  })
  it('does not restore the old child while parent login is in flight', async () => {
    const gate = deferred(); scene.deviceReadGate = gate.promise
    const login = api.redeemPersonalLink(parentLink)
    await flush()
    const restored = api.restorePersonalContext()
    await flush()
    try { expect(scene.reads).not.toContain('users/child') }
    finally { gate.resolve(); await Promise.allSettled([login, restored]) }
    const context = await restored
    expect(context?.session.personId).toBe('parent')
    expect(context?.profile.children[0].role).toBe('parent')
    expect(api.readCachedPersonalContext()?.session.personId).toBe('parent')
  })
  it('does not expose the former active person while a new link is being checked', async () => {
    const gate = deferred(); scene.deviceReadGate = gate.promise
    const login = api.redeemPersonalLink(parentLink)
    await flush()
    try { expect(() => api.currentEducationPersonId()).toThrow() }
    finally { gate.resolve(); await login }
    expect(api.currentEducationPersonId()).toBe('parent')
  })
  it('keeps the shared calendar parent-scoped after the concurrent login and restore settle', async () => {
    const gate = deferred(); scene.deviceReadGate = gate.promise
    const login = api.redeemPersonalLink(parentLink)
    await flush()
    const restored = api.restorePersonalContext()
    gate.resolve()
    await Promise.all([login, restored])
    const { loadLearningAccess } = await import('./learningRoute')
    const first = await loadLearningAccess('days', 'shared-calendar')
    const reopened = await loadLearningAccess('days', 'shared-calendar')
    expect(first).toMatchObject({ parent: true, token: 'parent-calendar', session: { personId: 'parent' } })
    expect(reopened).toMatchObject({ parent: true, token: 'parent-calendar', session: { personId: 'parent' } })
  })
  it('also waits when a parent deliberately enters the child profile, without retaining parent access', async () => {
    api.clearPersonalSession()
    api.rememberPersonalContext({ session: { personId: 'parent', deviceUid: 'same-browser', linkToken: parentLink }, profile: { personId: 'parent', displayName: 'Adult', children: [
      { familyId: 'family', childId: 'learner', displayName: 'Learner', role: 'parent', dashboardToken: 'parent-calendar', dashboardTokens: { student: 'shared-calendar', parent: 'parent-calendar' } },
    ] } })
    scene.deviceLink = parentLink
    const gate = deferred(); scene.deviceReadGate = gate.promise
    const login = api.redeemPersonalLink(childLink)
    await flush()
    const restored = api.restorePersonalContext()
    await flush()
    try { expect(scene.reads).not.toContain('users/parent') }
    finally { gate.resolve(); await Promise.allSettled([login, restored]) }
    expect((await restored)?.profile.children[0].role).toBe('student')
    expect(api.currentEducationPersonId()).toBe('child')
  })
  it('rejects a late profile save from the former identity after parent login completed', async () => {
    const previous = api.readCachedPersonalContext()!
    const session = await api.redeemPersonalLink(parentLink)
    const profile = await api.loadPersonalProfile(session)
    api.rememberPersonalContext({ session, profile })
    expect(() => api.rememberPersonalContext(previous)).toThrow('Личная сессия изменилась')
    expect(api.readCachedPersonalContext()?.profile.children[0].role).toBe('parent')
    expect(api.currentEducationPersonId()).toBe('parent')
  })
})
