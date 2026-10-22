// @vitest-environment jsdom
/** @see ../../docs/modules/families/early-development.md */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => [] as string[])
vi.mock('@/lib/personalAccess', () => ({ restorePersonalContext: async () => null }))
vi.mock('@/lib/educationStore', () => ({ markNotificationRead: vi.fn(), watchInbox: () => () => {} }))
vi.mock('@/lib/useParentChildOverview', () => ({ useParentChildOverview: (token: string) => { calls.push(token); return { state: 'none', weekendCards: 0 } } }))
vi.mock('./FamilyLibrary', () => ({ FamilyLibrary: () => null }))
vi.mock('./FamilyAccessCards', () => ({ FamilyAccessCards: () => null }))
import { ParentHome } from './ParentHome'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
it('opens an early child directly and does not subscribe it to school homework', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(<ParentHome profile={{ personId: 'adult', displayName: 'Родитель', children: [
    { familyId: 'family', childId: 'school', displayName: 'Школьник', role: 'parent', dashboardToken: 'school-board' },
    { familyId: 'family', childId: 'baby', displayName: 'Малыш', role: 'parent', learningMode: 'early-development' },
  ] }} />))
  expect(calls.every((value) => value === 'school-board')).toBe(true)
  expect(host.querySelector('a[href="#/early/family/baby"]')?.textContent).toContain('Раннее развитие')
  expect(host.textContent).not.toContain('Календарь не подключён')
  await act(async () => root.unmount()); host.remove()
})
