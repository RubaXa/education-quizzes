// @vitest-environment jsdom
// @see ../../docs/plans/local-first-release-plan-2026-10-12.md#startup-regression-contract
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({ listeners: new Map<string, (snapshot: unknown) => void>(), reads: 0,
  authGate: null as Promise<void> | null, uid: 'device' as string | null }))
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
  onSnapshot: (ref: { path: string }, _options: unknown, change: (snapshot: unknown) => void) => {
    probe.listeners.set(ref.path, change)
    probe.reads++
    return () => { probe.listeners.delete(ref.path) }
  },
  getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(), serverTimestamp: vi.fn(),
}))
vi.mock('./ParentHome', () => ({ ParentHome: ({ profile }: { profile: { displayName: string } }) => <main>Кабинет {profile.displayName}</main> }))
vi.mock('../DayDashboard', () => ({ default: () => <main>Кабинет ученика</main> }))

import { clearPersonalSession, readCachedPersonalContext, rememberPersonalContext } from '../lib/personalAccess'
import { PersonalEntry } from './PersonalEntry'

afterEach(() => { clearPersonalSession(); localStorage.clear(); probe.listeners.clear(); probe.reads = 0; probe.authGate = null; probe.uid = 'device' })

describe('personal cold start — no saved session', () => {
  it('does not invent a parent dashboard before Auth and shows link entry after an empty restore', async () => {
    let release!: () => void
    probe.authGate = new Promise<void>((resolve) => { release = resolve })
    probe.uid = null
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<PersonalEntry />) })
    expect(host.textContent).toContain('Проверяем личный доступ')
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
  it('waits for Auth and three authoritative confirmations, then closes on confirmed revocation', async () => {
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
    expect(host.textContent).toContain('Проверяем личный доступ')
    expect(host.textContent).not.toContain('Кабинет Взрослый')
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
