// @vitest-environment jsdom
/** @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersonalProfile } from '@/lib/personalAccess'

const scene = vi.hoisted(() => ({
  cached: null as PersonalProfile | null, server: null as PersonalProfile | null,
  callbacks: new Map<string, (snapshot: any) => void>(), options: [] as any[],
  refreshes: 0, closed: 0, uid: 'device',
}))
const session = { personId: 'person', deviceUid: 'device', linkToken: 'secret' }
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: scene.uid }, authStateReady: async () => undefined }) }))
vi.mock('@/lib/personalAccess', () => ({
  readCachedPersonalContext: () => scene.cached ? { session, profile: scene.cached, savedAt: Date.now() } : null,
  restorePersonalContext: async () => scene.cached ? { session, profile: scene.cached } : null,
  loadPersonalProfile: async () => { scene.refreshes++; return scene.server },
  rememberPersonalContext: (context: { profile: PersonalProfile }) => { scene.cached = context.profile },
  clearPersonalSession: () => { scene.closed++; scene.cached = null },
  redeemPersonalLink: async () => session, personalEntryUrl: () => '#/enter/example', secretFromPastedPersonalLink: (value: string) => value,
}))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  onSnapshot: (ref: { path: string }, options: any, handler?: (snapshot: any) => void) => {
    scene.callbacks.set(ref.path, typeof options === 'function' ? options : handler!)
    scene.options.push(typeof options === 'function' ? null : options)
    return () => { scene.callbacks.delete(ref.path) }
  },
}))
vi.mock('@/DayDashboard', async () => {
  const { default: ProblemTaskCard } = await import('./ProblemTaskCard')
  return { default: ({ parent = false }: { parent?: boolean }) => <ProblemTaskCard parent={parent}
    problem={{ id: 'problem', number: 1, title: 'Книги', detail: 'Выбрать пару', source: 'Учитель', support: {
      skill: 'Пары', state: 'unknown', evidence: 'Источник', evidenceRefs: ['sheet'], facts: [], find: 'Пары', revision: 1,
    } } as any} state={{ tone: 'ready', label: 'Не начато' }} links={[]} uploads={[]} helpAccess="ready"
    onPhotos={() => undefined} onRequestHelp={async () => undefined}
    guide={{ title: 'Разбор для родителя', revision: 1, presentation: 'math-route', stages: [
      { id: 'answer', role: 'answer', title: 'Ответ и проверка', expected: 'Проверяем пары', rows: [], answer: '1100', verification: ['Проверка'], source: { label: 'Учитель' } },
    ] } as any} /> }
})
vi.mock('./ParentHome', async () => {
  const { default: Dashboard } = await import('@/DayDashboard')
  return { ParentHome: () => <Dashboard parent token="parent-dashboard" /> }
})
import { PersonalEntry } from './PersonalEntry'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const cleanup: Array<() => void> = []
const profile = (role: 'parent' | 'student'): PersonalProfile => ({ personId: 'person', displayName: 'Person', children: [
  { familyId: 'family', childId: 'child', displayName: 'Child', role, dashboardToken: `${role}-dashboard` },
] })
beforeEach(() => {
  scene.cached = profile('parent'); scene.server = profile('parent'); scene.callbacks.clear(); scene.options = []
  scene.refreshes = 0; scene.closed = 0; scene.uid = 'device'
})
afterEach(async () => { await act(async () => cleanup.splice(0).forEach((close) => close())) })
async function render(initialLink?: string) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); cleanup.push(() => { root.unmount(); host.remove() })
  await act(async () => root.render(<PersonalEntry initialLink={initialLink} />))
  return host
}
async function confirm(path: string, data: object, fromCache = false) {
  await act(async () => scene.callbacks.get(path)?.({ exists: () => true, data: () => data, metadata: { fromCache } }))
}
async function confirmSession() {
  await confirm('accessLinks/secret', { active: true, personId: 'person' })
  await confirm('deviceSessions/device', { linkToken: 'secret' })
}
describe('root personal entry uses confirmed role through the real task card', () => {
  it('does not mount student actions from a warm profile before authoritative membership', async () => {
    scene.cached = profile('student')
    const host = await render()
    expect(host.textContent).not.toContain('Добавить фото решения')
    expect(host.textContent).toContain('Проверяем личный доступ')
    await confirmSession()
    await confirm('families/family/members/person', { active: true, role: 'parent', childIds: ['child'] }, true)
    expect(host.textContent).not.toContain('Добавить фото решения')
    // Unchanged SDK cache data gets only a metadata confirmation from the server.
    expect(scene.options.every((options) => options?.includeMetadataChanges)).toBe(true)
    await confirm('families/family/members/person', { active: true, role: 'parent', childIds: ['child'] })
    await confirmSession()
    await confirm('families/family/members/person', { active: true, role: 'parent', childIds: ['child'] })
    expect(host.textContent).toContain('Разбор для родителя')
    expect(host.textContent).not.toContain('Добавить фото решения')
    expect(scene.refreshes).toBe(1)
  })
  it('does not expose a cached parent guide after downgrade to student', async () => {
    scene.server = profile('student')
    const host = await render()
    expect(host.textContent).not.toContain('Разбор для родителя')
    await confirmSession()
    await confirm('families/family/members/person', { active: true, role: 'student', childIds: ['child'] })
    await confirmSession()
    await confirm('families/family/members/person', { active: true, role: 'student', childIds: ['child'] })
    expect(host.textContent).toContain('Добавить фото решения')
    expect(host.textContent).not.toContain('Разбор для родителя')
    expect(host.textContent).not.toContain('1100')
  })
  it('opens the existing parent card after personal-link login and closes on revocation', async () => {
    scene.cached = null
    const host = await render('secret')
    expect(host.textContent).not.toContain('Разбор для родителя')
    await confirmSession()
    await confirm('families/family/members/person', { active: true, role: 'parent', childIds: ['child'] })
    expect(host.textContent).toContain('Разбор для родителя')
    await confirm('accessLinks/secret', { active: false, personId: 'person' })
    expect(host.textContent).not.toContain('Разбор для родителя')
    expect(host.textContent).toContain('Войти в Education')
  })
  it('does not refresh unchanged membership or add extra listeners', async () => {
    const host = await render()
    await confirmSession()
    await confirm('families/family/members/person', { active: true, role: 'parent', childIds: ['child'] })
    expect(host.textContent).toContain('Разбор для родителя')
    expect(scene.options).toHaveLength(3)
    expect(scene.refreshes).toBe(0)
  })
  it('waits through cached grant/device/member snapshots and accepts metadata-only confirmations', async () => {
    const host = await render()
    await confirm('accessLinks/secret', { active: true, personId: 'person' }, true)
    await confirm('deviceSessions/device', { linkToken: 'secret' }, true)
    expect(host.textContent).not.toContain('Разбор для родителя')
    await confirmSession()
    await confirm('families/family/members/person', { active: true, role: 'parent', childIds: ['child'] }, true)
    expect(host.textContent).not.toContain('Разбор для родителя')
    await confirm('families/family/members/person', { active: true, role: 'parent', childIds: ['child'] })
    expect(host.textContent).toContain('Разбор для родителя')
  })
  it('reconciles an already visible student card when membership changes to parent', async () => {
    scene.cached = profile('student')
    const host = await render()
    await confirmSession()
    await confirm('families/family/members/person', { active: true, role: 'student', childIds: ['child'] })
    expect(host.textContent).toContain('Добавить фото решения')
    await confirm('families/family/members/person', { active: true, role: 'parent', childIds: ['child'] })
    expect(host.textContent).not.toContain('Добавить фото решения')
    await confirm('families/family/members/person', { active: true, role: 'parent', childIds: ['child'] })
    expect(host.textContent).toContain('Разбор для родителя')
    expect(scene.refreshes).toBe(1)
    expect(scene.options).toHaveLength(4) // Only this family's membership is resubscribed.
  })
  it('does not loop or show either role when a profile refresh still disagrees with membership', async () => {
    const host = await render()
    await confirmSession()
    await confirm('families/family/members/person', { active: true, role: 'student', childIds: ['child'] })
    expect(host.textContent).toContain('Не удалось подтвердить актуальные права')
    expect(host.textContent).not.toContain('Разбор для родителя')
    expect(host.textContent).not.toContain('Добавить фото решения')
    expect(scene.refreshes).toBe(1)
  })
  it('removes a revoked child instead of retaining the cached parent guide', async () => {
    const host = await render()
    await confirmSession()
    await confirm('families/family/members/person', { active: true, role: 'parent', childIds: ['child'] })
    expect(host.textContent).toContain('Разбор для родителя')
    scene.server = { ...profile('parent'), children: [] }
    await confirm('families/family/members/person', { active: false, role: 'parent', childIds: [] })
    expect(host.textContent).not.toContain('Разбор для родителя')
    expect(host.textContent).not.toContain('Добавить фото решения')
    expect(scene.cached?.children).toEqual([])
  })
  it('rejects a restored profile belonging to a different Firebase device', async () => {
    scene.uid = 'other-device'
    const host = await render()
    expect(host.textContent).toContain('Войти в Education')
    expect(host.textContent).not.toContain('Разбор для родителя')
    expect(host.textContent).not.toContain('Добавить фото решения')
    expect(scene.options).toHaveLength(0)
  })
})
