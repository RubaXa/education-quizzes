// @vitest-environment jsdom
/** @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersonalProfile } from '@/lib/personalAccess'

const scene = vi.hoisted(() => ({ profile: null as PersonalProfile | null, serverProfile: null as PersonalProfile | null, cached: false, restoreError: null as { code: string } | null, callbacks: new Map<string, (value: any) => void>(), records: new Map<string, object>(), options: [] as any[], reads: [] as string[], closed: 0, refreshes: 0 }))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'device' } }) }))
vi.mock('@/lib/personalAccess', async (original) => ({
  recoverPersonalContext: async () => false,
  watchPersonalContextChanges: (await original<typeof import('@/lib/personalAccess')>()).watchPersonalContextChanges,
  readCachedPersonalContext: () => scene.profile ? { session: { personId: 'person', deviceUid: 'device', linkToken: 'secret' }, profile: scene.profile } : null,
  restorePersonalContext: async () => { if (scene.restoreError) throw scene.restoreError; return scene.profile ? { session: { personId: 'person', deviceUid: 'device', linkToken: 'secret' }, profile: scene.profile } : null },
  loadPersonalProfile: async () => { scene.refreshes++; return scene.serverProfile ?? scene.profile },
  rememberPersonalContext: (context: { profile: PersonalProfile }) => { scene.profile = context.profile }, rememberPersonalDashboardRoute: vi.fn(), clearPersonalSession: () => { scene.closed++ },
}))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  getDoc: async (ref: { path: string }) => { scene.reads.push(ref.path); return { exists: () => true, data: () => ({ familyId: 'family', childId: 'child', viewTokens: { student: 'shared-day', parent: 'parent-day' } }) } },
  onSnapshot: (ref: { path: string }, options: any, handler?: (value: any) => void) => {
    const changed = typeof options === 'function' ? options : handler!
    scene.options.push(typeof options === 'function' ? null : options)
    scene.callbacks.set(ref.path, changed)
    const data = ref.path.startsWith('accessLinks/') ? { active: true, personId: 'person' }
      : ref.path.startsWith('deviceSessions/') ? { linkToken: 'secret' }
        : { active: true, role: (scene.serverProfile ?? scene.profile)?.children[0].role, childIds: ['child'] }
    scene.records.set(ref.path, data)
    changed({ exists: () => true, data: () => data, metadata: { fromCache: scene.cached } })
    return () => { scene.callbacks.delete(ref.path) }
  },
}))
vi.mock('@/DayDashboard', async () => {
  const { default: ProblemTaskCard } = await import('./ProblemTaskCard')
  return { default: ({ parent, token }: { parent: boolean; token: string }) => <section data-view-token={token}>
    <ProblemTaskCard parent={parent} problem={{ id: 'problem', number: 1, title: 'Книги', detail: 'Выбрать пару', source: 'Лист учителя', support: {
      skill: 'Выбор пары', state: 'unknown', evidence: 'Источник', evidenceRefs: ['sheet'], facts: [{ label: 'Полка', value: '10 книг' }], find: 'Число пар', revision: 1,
    } } as any} state={{ tone: 'ready', label: 'Не начато' }} links={[]} uploads={[]} helpAccess="ready" onPhotos={() => undefined} onRequestHelp={async () => undefined}
      guide={{ title: 'Разбор для родителя', revision: 1, presentation: 'math-route', stages: [
        { id: 'data', role: 'given', title: 'Данные', expected: 'Различаем полки', rows: [], source: { label: 'Учитель' } },
        { id: 'answer', role: 'answer', title: 'Ответ и проверка', expected: 'Проверяем пары', rows: [], answer: '1100', verification: ['Проверка'], source: { label: 'Учитель' } },
      ] } as any} />
  </section> }
})
vi.mock('@/DayPage', async () => ({ default: (await import('@/DayDashboard')).default }))
vi.mock('./OlympiadPage',()=>({default:({familyId,childId,parent,dashboardToken,canonicalToken}: {familyId:string;childId:string;parent:boolean;dashboardToken:string;canonicalToken:string})=><section data-family={familyId} data-child={childId} data-dashboard-token={dashboardToken} data-canonical-token={canonicalToken}>{parent?'Олимпиада родитель':'Олимпиада ученик'}</section>}))
import LearningRoute from './LearningRoute'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Array<() => void> = []
beforeEach(() => {
  scene.cached = false; scene.callbacks.clear(); scene.records.clear(); scene.options = []; scene.reads = []; scene.closed = 0
  scene.serverProfile = null; scene.refreshes = 0; scene.restoreError = null
  scene.profile = { personId: 'person', displayName: 'Person', children: [{ familyId: 'family', childId: 'child', displayName: 'Child', role: 'parent', dashboardToken: 'parent-dashboard', dashboardTokens: { student: 'shared-dashboard', parent: 'parent-dashboard' } }] }
})
afterEach(async () => { await act(async () => { roots.splice(0).forEach((close) => close()) }) })
async function render(mode: 'day' | 'days' = 'days', token = 'shared-dashboard') {
  history.replaceState(null, '', `/#/${mode}/${token}`)
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); roots.push(() => { root.unmount(); host.remove() })
  await act(async () => { root.render(<LearningRoute mode={mode} token={token} />) })
  return host
}
describe('authenticated route through the real problem card', () => {
  it('keeps the shared olympiad URL and passes the authorized family projection', async () => {
    history.replaceState(null, '', '/#/olympiad/shared-dashboard/demo-olympiad')
    const host=document.createElement('div');document.body.append(host)
    const root=createRoot(host);roots.push(()=>{root.unmount();host.remove()})
    await act(async()=>root.render(<LearningRoute mode="days" token="shared-dashboard" olympiadId="demo-olympiad" />))
    expect(location.hash).toBe('#/olympiad/shared-dashboard/demo-olympiad')
    expect(host.textContent).toContain('Олимпиада родитель')
    expect(host.querySelector('[data-child]')?.getAttribute('data-child')).toBe('child')
    expect(host.querySelector('[data-child]')?.getAttribute('data-dashboard-token')).toBe('parent-dashboard')
    expect(host.querySelector('[data-child]')?.getAttribute('data-canonical-token')).toBe('shared-dashboard')
  })
  it('keeps the saved guide when background profile restoration is offline', async () => {
    scene.restoreError = { code: 'unavailable' }
    const host = await render()
    expect(host.textContent).toContain('Разбор для родителя')
    expect(host.textContent).not.toContain('Добавить фото решения')
    expect(host.textContent).not.toContain('Проверяем личный доступ')
    expect(scene.closed).toBe(0)
    expect(scene.options).toHaveLength(0)
  })
  it('also restores a known current day locally without an identity request while offline', async () => {
    scene.profile!.children[0].dayToken = 'parent-day'
    scene.profile!.children[0].dayTokens = { parent: 'parent-day', student: 'shared-day' }
    scene.restoreError = { code: 'unavailable' }
    const host = await render('day', 'shared-day')
    expect(host.textContent).toContain('Разбор для родителя')
    expect(host.textContent).not.toContain('Добавить фото решения')
    expect(scene.reads).toEqual([])
  })
  it('updates the same mounted calendar when the role is saved in a sibling tab', async () => {
    scene.cached = true
    scene.profile!.children[0].role = 'student'
    scene.profile!.children[0].dashboardToken = 'shared-dashboard'
    const host = await render()
    expect(host.textContent).toContain('Добавить фото решения')
    scene.profile!.children[0].role = 'parent'
    scene.profile!.children[0].dashboardToken = 'parent-dashboard'
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'education-personal-context-v1' })))
    expect(host.textContent).toContain('Разбор для родителя')
    expect(host.textContent).not.toContain('Добавить фото решения')
    expect(location.hash).toBe('#/days/shared-dashboard')
  })
  it.each(['parent', 'student'] as const)('reconciles stale cached role to authoritative %s on the same shared URL', async (role) => {
    scene.serverProfile = structuredClone(scene.profile!)
    scene.serverProfile.children[0].role = role
    scene.serverProfile.children[0].dashboardToken = role === 'parent' ? 'parent-dashboard' : 'shared-dashboard'
    scene.profile!.children[0].role = role === 'parent' ? 'student' : 'parent'
    scene.profile!.children[0].dashboardToken = role === 'parent' ? 'shared-dashboard' : 'parent-dashboard'
    const host = await render()
    expect(host.textContent).toContain(role === 'parent' ? 'Разбор для родителя' : 'Добавить фото решения')
    expect(host.textContent).not.toContain(role === 'parent' ? 'Добавить фото решения' : 'Разбор для родителя')
    expect(scene.closed).toBe(0)
    expect(scene.refreshes).toBe(1)
    expect(scene.options).toHaveLength(3)
    expect(scene.reads).toEqual([])
  })
  it('shows a parent guide and no student controls on the shared /days URL', async () => {
    const host = await render()
    expect(host.querySelector('[data-view-token]')?.getAttribute('data-view-token')).toBe('parent-dashboard')
    expect(host.textContent).toContain('Разбор для родителя')
    expect(host.textContent).not.toContain('Добавить фото решения')
    expect(host.textContent).not.toContain('Нужен ориентир?')
    expect(location.hash).toBe('#/days/shared-dashboard')
    expect(scene.reads).toEqual([])
  })
  it('shows upload/help and no guide on exactly the same URL for a student', async () => {
    scene.profile!.children[0].role = 'student'; scene.profile!.children[0].dashboardToken = 'shared-dashboard'
    const host = await render()
    expect(host.textContent).toContain('Добавить фото решения')
    expect(host.textContent).toContain('Нужен ориентир?')
    expect(host.textContent).not.toContain('Разбор для родителя')
    expect(host.textContent).not.toContain('1100')
    expect(location.hash).toBe('#/days/shared-dashboard')
  })
  it('uses the same role for historical days and normalizes a legacy parent token', async () => {
    const host = await render('day', 'parent-day')
    expect(host.textContent).toContain('Разбор для родителя')
    expect(location.hash).toBe('#/day/shared-day')
    expect(scene.reads).toEqual(['dayPages/parent-day'])
  })
  it('renders the saved parent card while server access is unconfirmed', async () => {
    scene.cached = true
    const host = await render()
    expect(host.textContent).not.toContain('Проверяем личный доступ')
    expect(host.textContent).not.toContain('Добавить фото')
    expect(host.textContent).toContain('Разбор для родителя')
  })
  it('closes the prepared parent view when membership is revoked', async () => {
    const host = await render()
    await act(async () => scene.callbacks.get('families/family/members/person')!({ exists: () => true, data: () => ({ active: false }), metadata: { fromCache: false } }))
    expect(host.textContent).not.toContain('Разбор для родителя')
    expect(host.textContent).toContain('Доступ изменился')
    expect(scene.closed).toBe(1)
  })
  it('finishes a warm-cache access check when the server confirms unchanged documents', async () => {
    scene.cached = true
    const host = await render()
    expect(host.textContent).toContain('Разбор для родителя')
    expect(scene.options).toHaveLength(3)
    expect(scene.options.every((options) => options?.includeMetadataChanges === true)).toBe(true)
    await act(async () => {
      for (const [path, changed] of scene.callbacks) changed({ exists: () => true, data: () => scene.records.get(path), metadata: { fromCache: false } })
    })
    expect(host.textContent).toContain('Разбор для родителя')
    expect(host.textContent).not.toContain('Добавить фото решения')
  })
  it('requires a personal login instead of guessing from the shared token', async () => {
    scene.profile = null
    const host = await render()
    expect(host.textContent).toContain('личную ссылку')
    expect(host.querySelector('[data-view-token]')).toBeNull()
    expect(scene.callbacks.size).toBe(0)
  })
})
