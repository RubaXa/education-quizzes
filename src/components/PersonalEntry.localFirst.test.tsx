// @vitest-environment jsdom
// @see ../../docs/plans/local-first-release-plan-2026-10-12.md#startup-regression-contract
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({ listeners: new Map<string, (snapshot: unknown) => void>(), reads: 0,
  authGate: null as Promise<void> | null, uid: 'device' as string | null,
  replacement: null as 'parent' | 'student' | null, recoveryReads: [] as string[], failures: new Map<string, (cause: { code: string }) => void>() }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: probe.uid ? { uid: probe.uid } : null,
    authStateReady: () => probe.authGate ?? new Promise<void>(() => {}) }),
  signInAnonymously: vi.fn(),
}))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  onSnapshot: (ref: { path: string }, _options: unknown, change: (snapshot: unknown) => void, failed: (cause: { code: string }) => void) => {
    probe.listeners.set(ref.path, change)
    probe.failures.set(ref.path, failed)
    probe.reads++
    return () => { probe.listeners.delete(ref.path) }
  },
  getDoc: async (ref: { path: string }) => {
    probe.recoveryReads.push(ref.path)
    const role = probe.replacement
    const data = ref.path.startsWith('deviceSessions/') ? { linkToken: role ? 'r'.repeat(43) : 'a'.repeat(43) }
      : ref.path.startsWith('accessLinks/') ? { active: true, personId: 'replacement' }
        : ref.path.includes('/members/') ? { active: true, role, childIds: ['child'] }
          : ref.path.includes('/shortcuts/') ? { dashboardToken: `${role}-dashboard` }
            : { displayName: 'Recovered' }
    return { exists: () => true, data: () => data, metadata: { fromCache: false } }
  }, getDocs: async () => ({ docs: [{ id: 'family' }] }), setDoc: vi.fn(), serverTimestamp: vi.fn(),
}))
vi.mock('./ParentHome', () => ({ ParentHome: ({ profile }: { profile: { displayName: string } }) => <main>Кабинет {profile.displayName}</main> }))
vi.mock('../DayDashboard', () => ({ default: () => <main>Кабинет ученика</main> }))

import { clearPersonalSession, readCachedPersonalContext, rememberPersonalContext } from '../lib/personalAccess'
import { PersonalEntry } from './PersonalEntry'

afterEach(() => { clearPersonalSession(); localStorage.clear(); probe.listeners.clear(); probe.reads = 0; probe.authGate = null; probe.uid = 'device'; probe.replacement = null; probe.recoveryReads = []; probe.failures.clear(); vi.unstubAllGlobals() })

describe('personal cold start — no saved session', () => {
  it('does not invent a parent dashboard before Auth and shows link entry after an empty restore', async () => {
    let release!: () => void
    probe.authGate = new Promise<void>((resolve) => { release = resolve })
    probe.uid = null
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<PersonalEntry />) })
    expect(host.textContent).not.toContain('Проверяем личный доступ')
    expect(host.textContent).not.toContain('Кабинет')
    expect(probe.reads).toBe(0)
    await act(async () => { release() })
    expect(host.textContent).toContain('Войти в Education')
    expect(host.textContent).not.toContain('Кабинет')
    await act(async () => { root.unmount() })
    host.remove()
  })
})

describe('personal warm start — verified saved session', () => {
  const recoveryCases = (['parent', 'student'] as const).flatMap(role => ['browser', 'standalone'].flatMap(surface => ['device', 'grant', 'permission'].map(signal => ({ role, surface, signal }))))
  it.each(recoveryCases)('recovers the server-bound $role in $surface from a stale local identity after $signal without a pasted link', async ({ role, surface, signal }) => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: surface === 'standalone' && query === '(display-mode: standalone)' }))
    probe.authGate = Promise.resolve()
    probe.replacement = role
    const oldRole = role === 'parent' ? 'student' : 'parent'
    rememberPersonalContext({ session: { personId: 'previous', deviceUid: 'device', linkToken: 'o'.repeat(43) }, profile: { personId: 'previous', displayName: 'Old', children: [{ familyId: 'family', childId: 'child', displayName: 'Learner', role: oldRole, dashboardToken: `${oldRole}-dashboard` }] } })
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<PersonalEntry />))
      if (signal === 'permission') {
        // The grant listener can lose permission before the changed device binding is delivered.
        await act(async () => probe.failures.get(`accessLinks/${'o'.repeat(43)}`)!({ code: 'permission-denied' }))
      } else {
        const path = signal === 'device' ? 'deviceSessions/device' : `accessLinks/${'o'.repeat(43)}`
        await act(async () => probe.listeners.get(path)!({ exists: () => signal === 'device', data: () => ({ linkToken: 'r'.repeat(43) }), metadata: { fromCache: false } }))
      }
      expect(readCachedPersonalContext()?.session.personId).toBe('replacement')
      expect(readCachedPersonalContext()?.profile.children[0].role).toBe(role)
      expect(host.textContent).toContain(role === 'parent' ? 'Кабинет Recovered' : 'Кабинет ученика')
      expect(host.textContent).not.toContain('Войти в Education')
      expect(probe.recoveryReads.filter(path => path === 'deviceSessions/device')).toHaveLength(1)
    } finally { await act(async () => root.unmount()); host.remove() }
  })
  it.each(['parent', 'student'] as const)('does not erase a newly saved %s login when the old device listener fires before the storage event', async (nextRole) => {
    probe.authGate = Promise.resolve()
    const previousRole = nextRole === 'parent' ? 'student' : 'parent'
    const previous: Parameters<typeof rememberPersonalContext>[0] = { session: { personId: `old-${previousRole}`, deviceUid: 'device', linkToken: 'o'.repeat(43) }, profile: { personId: `old-${previousRole}`, displayName: 'Old', children: [{ familyId: 'family', childId: 'child', displayName: 'Learner', role: previousRole, dashboardToken: `${previousRole}-dashboard` }] } }
    rememberPersonalContext(previous)
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<PersonalEntry />))
      const oldDevice = probe.listeners.get('deviceSessions/device')!
      expect(oldDevice).toBeTypeOf('function')
      const next = { session: { personId: `new-${nextRole}`, deviceUid: 'device', linkToken: 'n'.repeat(43) }, profile: { personId: `new-${nextRole}`, displayName: 'New', children: [{ familyId: 'family', childId: 'child', displayName: 'Learner', role: nextRole, dashboardToken: `${nextRole}-dashboard` }] }, savedAt: Date.now() }
      // The sibling's durable write is visible before its StorageEvent reaches this tab.
      localStorage.setItem('education-personal-context-v1', JSON.stringify(next))
      await act(async () => oldDevice({ exists: () => true, data: () => ({ linkToken: next.session.linkToken }), metadata: { fromCache: false } }))
      expect(readCachedPersonalContext()?.session.personId).toBe(`new-${nextRole}`)
      expect(host.textContent).toContain(nextRole === 'parent' ? 'Кабинет New' : 'Кабинет ученика')
      expect(host.textContent).not.toContain('отозвана')
      await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'education-personal-context-v1' })))
      expect(host.textContent).toContain(nextRole === 'parent' ? 'Кабинет New' : 'Кабинет ученика')
    } finally { await act(async () => root.unmount()); host.remove() }
  })
  it('renders the saved parent view before Auth/server, then closes on confirmed revocation', async () => {
    let release!: () => void
    probe.authGate = new Promise<void>((resolve) => { release = resolve })
    rememberPersonalContext({
      session: { personId: 'person', deviceUid: 'device', linkToken: 'a'.repeat(43) },
      profile: { personId: 'person', displayName: 'Взрослый', children: [{ familyId: 'family', childId: 'child', displayName: 'ученик', role: 'parent', dashboardToken: 'dashboard' }] },
    })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<PersonalEntry />) })
    expect(host.textContent).not.toContain('Проверяем личный доступ')
    expect(host.textContent).toContain('Кабинет Взрослый')
    expect(probe.reads).toBe(0)
    await act(async () => { release() })
    await act(async () => {
      probe.listeners.get(`accessLinks/${'a'.repeat(43)}`)?.({ metadata: { fromCache: false }, exists: () => true, data: () => ({ active: true, personId: 'person' }) })
      probe.listeners.get('deviceSessions/device')?.({ metadata: { fromCache: false }, exists: () => true, data: () => ({ linkToken: 'a'.repeat(43) }) })
    })
    await act(async () => {
      probe.listeners.get('families/family/members/person')?.({ metadata: { fromCache: false }, exists: () => true, data: () => ({ active: true, role: 'parent', childIds: ['child'] }) })
    })
    expect(host.textContent).toContain('Кабинет Взрослый')
    expect(probe.reads).toBe(3) // grant, device binding, family membership
    await act(async () => {
      probe.listeners.get(`accessLinks/${'a'.repeat(43)}`)?.({ metadata: { fromCache: false }, exists: () => false })
    })
    expect(host.textContent).toContain('Войти в Education')
    expect(readCachedPersonalContext()).toBeNull()
    await act(async () => { root.unmount() })
    host.remove()
  })
})
