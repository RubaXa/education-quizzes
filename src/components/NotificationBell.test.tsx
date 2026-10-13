// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({ marked: [] as string[][], cached: null as any, delayInbox: false,
  requireRestoredSession: false, sessionReady: false, subscriptions: 0, restoreGate: null as Promise<void> | null,
  inboxChange: null as ((items: unknown[]) => void) | null, inboxError: null as ((error: Error) => void) | null }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('firebase/auth', () => ({ getAuth: () => ({}), onAuthStateChanged: (_auth: unknown, callback: () => void) => { callback(); return () => {} } }))
vi.mock('@/lib/personalAccess', () => ({ readCachedPersonalContext: () => probe.cached,
  restorePersonalContext: async () => { await (probe.restoreGate ?? Promise.resolve()); probe.sessionReady = true; return { session: { personId: 'person' },
  profile: { children: [{ familyId: 'family', childId: 'child', role: 'parent', dashboardToken: 'calendar' }] } } } }))
vi.mock('@/lib/educationStore', () => ({
  watchInbox: (onChange: (items: unknown[]) => void, onError: (error: Error) => void) => {
    probe.subscriptions++
    probe.inboxChange = onChange
    probe.inboxError = onError
    if (probe.requireRestoredSession && !probe.sessionReady) throw new Error('Откройте личную ссылку Education.')
    if (!probe.delayInbox) onChange([{ id: 'homework', type: 'homework_published', familyId: 'family', childId: 'child',
      entityId: 'homework', date: '2026-10-13', subject: 'Математика', sourceRevision: 1, createdAt: '2026-10-13T10:00:00Z' }])
    return () => {}
  },
  markNotificationsRead: async (ids: string[]) => { probe.marked.push(ids) },
}))

import NotificationBell from './NotificationBell'
import { writeCachedInbox } from '@/lib/inboxCache'

afterEach(() => { probe.marked.length = 0; probe.cached = null; probe.delayInbox = false;
  probe.requireRestoredSession = false; probe.sessionReady = false; probe.subscriptions = 0;
  probe.restoreGate = null; probe.inboxChange = null; probe.inboxError = null; localStorage.clear() })

describe('notification center read history', () => {
  it('keeps the cached bell visible but subscribes only after the personal session is restored', async () => {
    probe.cached = { session: { personId: 'person', deviceUid: 'device' },
      profile: { children: [{ familyId: 'family', childId: 'child', role: 'parent', dashboardToken: 'calendar' }] } }
    probe.requireRestoredSession = true
    let releaseRestore!: () => void
    probe.restoreGate = new Promise<void>((resolve) => { releaseRestore = resolve })
    writeCachedInbox('person', [{ id: 'homework', type: 'homework_published', familyId: 'family', childId: 'child',
      entityId: 'homework', date: '2026-10-13', subject: 'Математика', sourceRevision: 1,
      createdAt: '2026-10-13T10:00:00Z' }])
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<NotificationBell routeKey="#/" />) })
    expect(host.querySelector('.notification-bell')?.getAttribute('aria-label')).toContain('непрочитанных: 1')
    expect(probe.subscriptions).toBe(0)
    await act(async () => { releaseRestore() })
    await act(async () => { host.querySelector<HTMLButtonElement>('.notification-bell')!.click() })
    expect(probe.subscriptions).toBe(1)
    expect(host.querySelector('.notification-error')).toBeNull()
    expect(host.textContent).toContain('Появилось домашнее задание')
    await act(async () => { root.unmount() }); host.remove()
  })
  it('shows the last known unread count before the inbox subscription responds', async () => {
    probe.cached = { session: { personId: 'person', deviceUid: 'device' },
      profile: { children: [{ familyId: 'family', childId: 'child', role: 'parent', dashboardToken: 'calendar' }] } }
    probe.delayInbox = true
    writeCachedInbox('person', [{ id: 'homework', type: 'homework_published', familyId: 'family', childId: 'child',
      entityId: 'homework', date: '2026-10-13', subject: 'Математика', sourceRevision: 1,
      createdAt: '2026-10-13T10:00:00Z' }])
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<NotificationBell routeKey="#/" />) })
    expect(host.querySelector('.notification-bell')?.getAttribute('aria-label')).toContain('непрочитанных: 1')
    await act(async () => { root.unmount() }); host.remove()
  })
  it('preserves the last inbox during an error and clears that error after a fresh snapshot', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<NotificationBell routeKey="#/" />) })
    await act(async () => { host.querySelector<HTMLButtonElement>('.notification-bell')!.click() })
    await act(async () => { probe.inboxError?.(new Error('temporary failure')) })
    expect(host.textContent).toContain('Появилось домашнее задание')
    expect(host.querySelector('.notification-error')).not.toBeNull()
    await act(async () => { probe.inboxChange?.([{ id: 'homework', type: 'homework_published', familyId: 'family', childId: 'child',
      entityId: 'homework', date: '2026-10-13', subject: 'Математика', sourceRevision: 1, createdAt: '2026-10-13T10:00:00Z' }]) })
    expect(host.querySelector('.notification-error')).toBeNull()
    await act(async () => { root.unmount() }); host.remove()
  })
  it('moves a read homework notice out of the new list without deleting its history', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(<NotificationBell routeKey="#/" />) })
    await act(async () => { host.querySelector<HTMLButtonElement>('.notification-bell')!.click() })
    expect(host.textContent).toContain('Появилось домашнее задание')
    const notice = host.querySelector<HTMLButtonElement>('.notification-item')!
    await act(async () => { notice.click() })
    expect(probe.marked).toEqual([['homework']])
    await act(async () => { host.querySelector<HTMLButtonElement>('.notification-item')!.click() })
    expect(host.textContent).toContain('Новых обновлений нет.')
    expect(host.querySelector('.notification-item')).toBeNull()
    await act(async () => { host.querySelector<HTMLButtonElement>('.notification-history-toggle')!.click() })
    expect(host.textContent).toContain('Появилось домашнее задание')
    await act(async () => { root.unmount() })
    host.remove()
  })
})
