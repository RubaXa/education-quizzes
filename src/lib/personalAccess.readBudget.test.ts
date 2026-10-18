import { beforeEach, describe, expect, it, vi } from 'vitest'
// @see ../../docs/plans/local-first-release-plan-2026-10-12.md#startup-regression-contract

const probe = vi.hoisted(() => ({ delivered: 0, requests: [] as string[], grantGate: null as Promise<void> | null }))
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'device' }, authStateReady: async () => {} }),
  signInAnonymously: vi.fn(),
}))
vi.mock('firebase/firestore', () => {
  const data = (value: Record<string, unknown>) => ({ exists: () => true, data: () => value })
  return {
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    getDoc: async (ref: { path: string }) => {
      probe.requests.push(ref.path)
      probe.delivered++
      if (ref.path === 'deviceSessions/device') return data({ linkToken: 'a'.repeat(43) })
      if (ref.path.startsWith('accessLinks/')) { if (probe.grantGate) await probe.grantGate; return data({ active: true, personId: 'person' }) }
      if (ref.path === 'users/person') return data({ displayName: 'Взрослый' })
      if (ref.path === 'families/family/members/person') return data({ active: true, role: 'parent', childIds: ['child'] })
      if (ref.path === 'families/family/children/child') return data({ displayName: 'Ученик' })
      if (ref.path === 'users/person/families/family/shortcuts/child') return data({ dashboardToken: 'dashboard' })
      throw new Error(`Unexpected path ${ref.path}`)
    },
    getDocs: async (ref: { path: string }) => {
      probe.requests.push(ref.path)
      probe.delivered++
      if (ref.path !== 'users/person/families') throw new Error(`Unexpected path ${ref.path}`)
      return { docs: [{ id: 'family' }] }
    },
    serverTimestamp: () => null,
    setDoc: vi.fn(),
  }
})

import { clearPersonalSession, dayHelpSessionRole, readCachedPersonalContext, readLastPersonalDashboardRoute, rememberPersonalContext, rememberPersonalDashboardRoute, restorePersonalContext } from './personalAccess'

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
})

beforeEach(() => { clearPersonalSession(); storage.clear(); probe.delivered = 0; probe.requests.length = 0; probe.grantGate = null })

describe('personal cold start — no saved profile', () => {
  it('delivers one profile graph to two simultaneous consumers', async () => {
    const [entry, bell] = await Promise.all([restorePersonalContext(), restorePersonalContext()])
    expect(entry?.profile.children).toHaveLength(1)
    expect(bell?.session.personId).toBe('person')
    const baselineDelivered = 14 // Two independent callers each read seven documents.
    expect(probe.delivered).toBe(7)
    const reductionPercent = (baselineDelivered - probe.delivered) / baselineDelivered * 100
    expect(reductionPercent).toBeGreaterThanOrEqual(20)
    console.log(JSON.stringify({ scenario: 'personal-startup/entry-and-bell/one-child', metric: 'delivered-documents',
      baseline: baselineDelivered, candidate: probe.delivered, reductionPercent }))
  })

  it('cannot restore a grant after the local session was revoked mid-read', async () => {
    let release!: () => void
    probe.grantGate = new Promise<void>((resolve) => { release = resolve })
    const pending = restorePersonalContext()
    await vi.waitFor(() => expect(probe.requests.some((path) => path.startsWith('accessLinks/'))).toBe(true))
    clearPersonalSession()
    release()
    await expect(pending).rejects.toThrow('Личная сессия изменилась')
    probe.grantGate = null
    await expect(restorePersonalContext()).resolves.toMatchObject({ session: { personId: 'person' } })
  })
})

describe('personal warm start — saved profile and route', () => {
  it('uses this child membership for guidance even when the same person is a student elsewhere, without reloading the profile graph', async () => {
    rememberPersonalContext({ session: { personId: 'person', deviceUid: 'device', linkToken: 'a'.repeat(43) }, profile: { personId: 'person', displayName: 'Person', children: [
      { familyId: 'other-family', childId: 'other-child', displayName: 'Other', role: 'student' },
      { familyId: 'family', childId: 'child', displayName: 'Child', role: 'parent' },
    ] } })
    expect(await dayHelpSessionRole({ familyId: 'family', childId: 'child' })).toBe('parent')
    expect(await dayHelpSessionRole({ familyId: 'other-family', childId: 'other-child' })).toBe('student')
    expect(await dayHelpSessionRole({ familyId: 'missing', childId: 'child' })).toBeNull()
    expect(await dayHelpSessionRole()).toBeNull()
    expect(probe.delivered).toBe(0)
  })
  it('opens the warm personal profile without fetching the seven-document graph again', async () => {
    await restorePersonalContext()
    expect(probe.delivered).toBe(7)
    expect(readCachedPersonalContext()?.profile.children[0].displayName).toBe('Ученик')
    probe.delivered = 0
    probe.requests.length = 0
    const context = await restorePersonalContext()
    expect(context?.profile.children[0].role).toBe('parent')
    expect(probe.delivered).toBe(0)
    const reductionPercent = (7 - probe.delivered) / 7 * 100
    expect(reductionPercent).toBeGreaterThanOrEqual(20)
    console.log(JSON.stringify({ scenario: 'personal-startup/warm-profile', metric: 'delivered-documents',
      baseline: 7, candidate: probe.delivered, reductionPercent }))
  })

  it('discards the durable profile when access is revoked locally', async () => {
    await restorePersonalContext()
    rememberPersonalDashboardRoute('#/days-parent/dashboard')
    expect(readLastPersonalDashboardRoute()).toBe('#/days/dashboard')
    expect(readCachedPersonalContext()).not.toBeNull()
    clearPersonalSession()
    expect(readCachedPersonalContext()).toBeNull()
    expect(readLastPersonalDashboardRoute()).toBeNull()
  })

  it('normalizes a known resource across legacy role prefixes and refuses an unknown resource or invalid cache', async () => {
    await restorePersonalContext()
    rememberPersonalDashboardRoute('#/days/dashboard')
    expect(readLastPersonalDashboardRoute()).toBe('#/days/dashboard')
    rememberPersonalDashboardRoute('#/days/foreign-dashboard')
    expect(readLastPersonalDashboardRoute()).toBeNull()
    storage.set('education-personal-context-v1', '{broken')
    expect(readCachedPersonalContext()).toBeNull()
  })
})
