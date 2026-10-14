// @vitest-environment jsdom
// @see ../../docs/architecture/local-first-release-plan-2026-10-12.md#startup-regression-contract
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersonalProfile } from '@/lib/personalAccess'

const probe = vi.hoisted(() => ({ paths: [] as string[], active: new Map<string, number>(), errors: new Map<string, (error: Error) => void>(),
  values: new Map<string, (snapshot: any) => void>(), listeners: new Map<string, Array<(snapshot: any) => void>>(), restoreGate: null as Promise<void> | null, authGate: null as Promise<void> | null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Count real component subscriptions against a fake Firestore boundary. This
// measures query targets, not Firestore's billed document reads.
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/auth')>(),
  getAuth: () => ({ authStateReady: async () => { if (probe.authGate) await probe.authGate }, currentUser: { uid: 'device' } }),
}))
vi.mock('@/lib/personalAccess', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/personalAccess')>(),
  restorePersonalContext: async () => { if (probe.restoreGate) await probe.restoreGate; return { session: { personId: 'person', deviceUid: 'device', linkToken: 'a'.repeat(43) }, profile } },
}))
vi.mock('@/lib/educationStore', () => ({
  watchInbox: () => {
    const path = 'users/person/inbox'
    probe.paths.push(path)
    probe.active.set(path, (probe.active.get(path) ?? 0) + 1)
    return () => probe.active.set(path, (probe.active.get(path) ?? 1) - 1)
  },
  markNotificationRead: async () => {},
}))
vi.mock('firebase/firestore', async (importOriginal) => {
  const original = await importOriginal<typeof import('firebase/firestore')>()
  const reference = (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })
  return {
    ...original,
    doc: reference,
    collection: reference,
    query: (value: { path: string }) => value,
    onSnapshot: (value: { path: string }, ...handlers: unknown[]) => {
      probe.paths.push(value.path)
      probe.active.set(value.path, (probe.active.get(value.path) ?? 0) + 1)
      const onError = handlers.at(-1)
      if (typeof onError === 'function') probe.errors.set(value.path, onError as (error: Error) => void)
      const onValue = handlers.find((handler) => typeof handler === 'function')
      if (typeof onValue === 'function') {
        probe.values.set(value.path, onValue as (snapshot: any) => void)
        probe.listeners.set(value.path, [...(probe.listeners.get(value.path) ?? []), onValue as (snapshot: any) => void])
      }
      return () => probe.active.set(value.path, (probe.active.get(value.path) ?? 1) - 1)
    },
  }
})

import { ParentHome } from './ParentHome'

const profile: PersonalProfile = {
  personId: 'person', displayName: 'Взрослый',
  children: [{ familyId: 'family', childId: 'child', displayName: 'Ученик', role: 'parent', dashboardToken: 'calendar' }],
}

// Captured from the same fixture before the first read-shedding change.
// The SDK may deduplicate identical dashboard listeners, so compare unique targets.
const baselinePaths = [
  'dayDashboards/calendar',
  'families/family/children/child/accessGrants',
  'families/family/children/child/accessRequests',
  'families/family/children/child/bookRequirements',
  'families/family/children/child/bookUploads',
  'families/family/children/child/books',
  'families/family/children/child/syncStatus/current',
  'families/family/members',
  'families/family/members/person',
  'users/person/inbox',
  'users/person/inviteRequests',
  'users/person/inviteRevocations',
  'users/person/invites',
]

let enterViewport: (() => void) | undefined
class ViewportObserver {
  private readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    enterViewport = () => this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T05:00:00.000Z')) })
afterEach(() => { probe.paths.length = 0; probe.active.clear(); probe.errors.clear(); probe.values.clear(); probe.listeners.clear(); probe.restoreGate = null; probe.authGate = null; enterViewport = undefined; localStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers() })

const booksPath = 'families/family/children/child/books'
const uploadsPath = 'families/family/children/child/bookUploads'
const requirementsPath = 'families/family/children/child/bookRequirements'
const mathBook = { id: 'book', childId: 'child', subjectKey: 'математика', bookId: 'book', title: 'Математика',
  status: 'confirmed', pagesPublishedSha256: 'sha', catalogSha256: 'sha', pagesPublishedAt: { seconds: 1, nanoseconds: 0 } }
function bookSnapshot(items: object[], fromCache: boolean) {
  return { metadata: { fromCache }, docs: items.map(({ id, ...data }: any) => ({ id, data: () => data })) }
}
function calendarSnapshot(fromCache: boolean) {
  return { metadata: { fromCache }, exists: () => true, data: () => ({ kind: 'parent', today: '2026-10-13', timezone: 'Europe/Moscow',
    days: [{ date: '2026-10-14', checkedAt: null, complete: true, schedule: [{ subject: 'Математика', start: '08:30', end: '09:15' }], homework: [], dayToken: null }] }) }
}

describe('parent home warm start — complete local snapshot', () => {
  it('shows the saved family book count until all live streams are ready', async () => {
    localStorage.setItem('education-family-library-v1:family:child', JSON.stringify({ loading: false, error: '', observedDays: 1,
      observedSubjects: 1, unobservedChildren: [], needs: [], books: [mathBook] }))
    vi.stubGlobal('IntersectionObserver', ViewportObserver)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ParentHome profile={profile} />) })
    expect(host.textContent).toContain('Библиотека семьи · 1 книга')
    expect(host.textContent).not.toContain('Библиотека семьи · 0 книг')
    await act(async () => { probe.errors.get('families/family/children/child/books')?.(new Error('Temporary connection failure')) })
    expect(host.textContent).toContain('Библиотека семьи · 1 книга')
    expect(host.textContent).not.toContain('Нужны учебники и материалы')
    expect(host.textContent).not.toContain('Библиотека семьи · 0 книг')
    await act(async () => { root.unmount() })
    host.remove()
  })
  it('keeps the verified book count through stale Firestore snapshots, then swaps to the complete server revision', async () => {
    localStorage.setItem('education-family-library-v1:family:child', JSON.stringify({ loading: false, error: '', observedDays: 1,
      observedSubjects: 1, unobservedChildren: [], needs: [], books: [mathBook] }))
    vi.stubGlobal('IntersectionObserver', ViewportObserver)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ParentHome profile={profile} />) })
    await act(async () => {
      probe.values.get('dayDashboards/calendar')?.(calendarSnapshot(true))
      probe.values.get(booksPath)?.(bookSnapshot([], true))
      probe.values.get(uploadsPath)?.(bookSnapshot([], true))
      probe.values.get(requirementsPath)?.(bookSnapshot([], true))
    })
    expect(host.textContent).toContain('Библиотека семьи · 1 книга')
    expect(host.querySelector('.family-library-refresh')).toBeNull()
    await act(async () => {
      probe.values.get('dayDashboards/calendar')?.(calendarSnapshot(false))
      probe.values.get(booksPath)?.(bookSnapshot([mathBook, { ...mathBook, id: 'book-2', bookId: 'book-2', title: 'Математика, часть 2' }], false))
      probe.values.get(uploadsPath)?.(bookSnapshot([], false))
      probe.values.get(requirementsPath)?.(bookSnapshot([], false))
    })
    expect(host.textContent).toContain('Библиотека семьи · 2')
    expect(host.querySelector('.family-library-refresh')).toBeNull()
    await act(async () => { root.unmount() })
    host.remove()
  })
  it('keeps a saved homework badge while checking the current data', async () => {
    localStorage.setItem('education-parent-overview-v1:person:calendar', JSON.stringify({ state: 'ready',
      day: { date: '2026-10-14', checkedAt: '2026-10-13T07:00:00.000Z', complete: true, schedule: [], homework: [] },
      subjects: [{ id: 'math', name: 'Математика', state: 'todo', items: [{ id: '1', title: 'Задача', state: 'todo', detail: 'Осталось решить' }] }],
      done: 4, todo: 1, checking: 0, unclear: 0, total: 5, weekendCards: 0, reason: '', error: '', cachedAt: Date.now() }))
    vi.stubGlobal('IntersectionObserver', ViewportObserver)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ParentHome profile={profile} />) })
    expect(host.textContent).toContain('1 осталось')
    expect(host.textContent).not.toContain('Сверяем изменения')
    expect(host.querySelector('.parent-child-refresh')).toBeNull()
    expect(host.querySelector<HTMLAnchorElement>('.parent-child-open')?.getAttribute('href')).toBe('#/days-parent/calendar')
    await act(async () => { host.querySelector<HTMLAnchorElement>('.parent-child-open')?.click() })
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    expect(sessionStorage.getItem('education-dashboard-selected-date')).toBe(today)
    await act(async () => { root.unmount() })
    host.remove()
  })
  it('shows new MESH homework and check time even if result streams have not finished', async () => {
    localStorage.setItem('education-parent-overview-v1:person:calendar', JSON.stringify({ state: 'ready',
      day: { date: '2026-10-14', checkedAt: '2026-10-12T09:00:00.000Z', complete: true, schedule: [],
        homework: [{ subject: 'Литература', text: 'Читать' }] },
      subjects: [{ id: 'literature', name: 'Литература', state: 'todo', items: [{ id: 'lit', title: 'Читать', state: 'todo', detail: 'Не закончено' }] }],
      done: 0, todo: 1, checking: 0, unclear: 0, total: 1, weekendCards: 0, reason: '', error: '', cachedAt: Date.now() }))
    vi.stubGlobal('IntersectionObserver', ViewportObserver)
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ParentHome profile={profile} />) })
    const updated = { metadata: { fromCache: false }, exists: () => true, data: () => ({ kind: 'parent', today: '2026-10-13', timezone: 'Europe/Moscow',
      days: [{ date: '2026-10-14', checkedAt: '2026-10-13T14:00:00.000Z', complete: true,
        schedule: [{ subject: 'История', start: '2026-10-14T05:30:00.000Z', end: '2026-10-14T06:15:00.000Z' }],
        homework: [{ subject: 'Литература', text: 'Читать' }, { subject: 'История', text: 'Параграф 8' }],
        dayToken: null, homeworkDayToken: 'work-14' }] }) }
    await act(async () => { probe.listeners.get('dayDashboards/calendar')?.forEach((listener) => listener(updated)) })
    await act(async () => { host.querySelector<HTMLButtonElement>('.parent-child-toggle')?.click() })
    expect(host.querySelector('.parent-child-detail')?.textContent).toContain('История')
    expect(host.querySelector('.parent-child-detail')?.textContent).toContain('Параграф 8')
    expect(host.querySelector('.parent-child-source')?.textContent).toContain('13 окт')
    await act(async () => { root.unmount() }); host.remove()
  })
  it('draws the cached child before personal restoration and starts inbox only after it', async () => {
    let release!: () => void
    probe.restoreGate = new Promise<void>((resolve) => { release = resolve })
    vi.stubGlobal('IntersectionObserver', ViewportObserver)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ParentHome profile={profile} />) })
    expect(host.textContent).toContain('Ученик')
    expect(probe.paths).not.toContain('users/person/inbox')
    await act(async () => { release() })
    expect(probe.paths).toContain('users/person/inbox')
    await act(async () => { root.unmount() })
    host.remove()
  })
})

describe('parent home cold start — no complete local snapshot', () => {
  it('defers protected family subscriptions until Firebase Auth is ready', async () => {
    let release!: () => void
    probe.authGate = new Promise<void>((resolve) => { release = resolve })
    vi.stubGlobal('IntersectionObserver', ViewportObserver)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ParentHome profile={profile} />) })
    expect(probe.paths).toContain('dayDashboards/calendar')
    expect(probe.paths).not.toContain(booksPath)
    expect(host.textContent).not.toContain('Библиотека семьи · 0 книг')
    await act(async () => { release() })
    expect(probe.paths).toContain(booksPath)
    await act(async () => { root.unmount() })
    host.remove()
  })
  it('does not invent missing books or zero books when the first refresh fails', async () => {
    vi.stubGlobal('IntersectionObserver', ViewportObserver)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ParentHome profile={profile} />) })
    await act(async () => { probe.errors.get(booksPath)?.(new Error('Temporary connection failure')) })
    expect(host.textContent).toContain('Библиотека семьи')
    expect(host.textContent).not.toContain('Библиотека семьи · 0 книг')
    expect(host.textContent).not.toContain('Нужны учебники и материалы')
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await act(async () => {
      probe.values.get('dayDashboards/calendar')?.(calendarSnapshot(false))
      probe.values.get(booksPath)?.(bookSnapshot([mathBook], false))
      probe.values.get(uploadsPath)?.(bookSnapshot([], false))
      probe.values.get(requirementsPath)?.(bookSnapshot([], false))
    })
    expect(host.textContent).toContain('Библиотека семьи · 1 книга')
    await act(async () => { root.unmount() })
    host.remove()
  })
  it('waits for a server-confirmed family member list before showing an adult count', async () => {
    vi.stubGlobal('IntersectionObserver', ViewportObserver)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ParentHome profile={profile} />) })
    await act(async () => { enterViewport?.() })
    await act(async () => { probe.values.get('families/family/members')?.(bookSnapshot([], true)) })
    expect(host.textContent).toContain('Состав семьи уточняется')
    expect(host.textContent).not.toContain('0 взрослых')
    await act(async () => { probe.values.get('families/family/members')?.(bookSnapshot([{ id: 'person', role: 'parent', active: true, childIds: ['child'] }], false)) })
    expect(host.textContent).toContain('1 взрослых')
    await act(async () => { root.unmount() })
    host.remove()
  })
  it('cuts initial targets by at least 20% and loads access when it enters view', async () => {
    vi.stubGlobal('IntersectionObserver', ViewportObserver)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ParentHome profile={profile} />) })
    const coldPaths = [...new Set(probe.paths)].sort()
    expect(baselinePaths).toHaveLength(13)
    expect(coldPaths).toEqual([
      'dayDashboards/calendar',
      'families/family/children/child/bookRequirements',
      'families/family/children/child/bookUploads',
      'families/family/children/child/books',
      'users/person/inbox',
    ])
    expect((baselinePaths.length - coldPaths.length) / baselinePaths.length).toBeGreaterThanOrEqual(0.2)
    console.log(JSON.stringify({ scenario: 'parent-home/cold-start/one-child', metric: 'unique-query-targets', baseline: baselinePaths.length,
      candidate: coldPaths.length, reductionPercent: Math.round((baselinePaths.length - coldPaths.length) / baselinePaths.length * 1000) / 10 }))
    expect(host.textContent).toContain('Открыть управление семьёй')
    await act(async () => { enterViewport?.() })
    expect([...new Set(probe.paths)].sort()).toEqual(baselinePaths.filter((path) => path !== 'families/family/children/child/syncStatus/current'))
    expect(host.textContent).toContain('Члены семьи')
    expect(host.textContent).toContain('Проверяем право приглашать')
    expect(host.textContent).not.toContain('Осталось приглашений: 0')
    expect([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Новая ссылка'))?.disabled).toBe(true)
    const child = host.querySelector<HTMLButtonElement>('.parent-child-toggle')
    expect(child).not.toBeNull()
    await act(async () => { child?.click() })
    expect(probe.paths).not.toContain('families/family/children/child/syncStatus/current')
    expect(host.textContent).not.toContain('Сбор остановлен')
    await act(async () => { child?.click() })
    expect(probe.paths).not.toContain('families/family/children/child/syncStatus/current')
    await act(async () => { root.unmount() })
    host.remove()
    expect([...probe.active.values()].every((count) => count === 0)).toBe(true)
  })

  it('opens family controls by keyboard-accessible button without waiting for scrolling', async () => {
    vi.stubGlobal('IntersectionObserver', ViewportObserver)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ParentHome profile={profile} />) })
    const button = host.querySelector<HTMLButtonElement>('.parent-family-open')
    expect(button?.textContent).toBe('Открыть управление семьёй')
    await act(async () => { button?.click() })
    expect(probe.paths).toContain('families/family/members')
    await act(async () => { root.unmount() })
    host.remove()
  })
})
