// @vitest-environment jsdom
/** Real route → dashboard → weekend → problem → guide/review composition.
 * @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersonalProfile } from '@/lib/personalAccess'
import type { DayPageData, DayWorkReview } from '@/lib/dayStore'

const scene = vi.hoisted(() => ({ role: 'parent' as 'parent' | 'student', personId: 'person', link: 'p'.repeat(43), profile: null as PersonalProfile | null, forbidPrevious: false, callbacks: new Map<string, (snapshot: any) => void>(), reviews: [] as DayWorkReview[], guideReads: [] as string[], reviewRoles: [] as boolean[], reviewListeners: new Set<(reviews: DayWorkReview[]) => void>(), diagnostics: false, diagnosticWrites: [] as Record<string, unknown>[] }))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('@/lib/dayGuidance', () => ({ watchDayGuidance: (_token: string, changed: (items: unknown[]) => void) => { changed([]); return () => {} }, sendDayGuidance: vi.fn() }))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'device' }, authStateReady: async () => {} }) }))
vi.mock('firebase/firestore', () => ({
  serverTimestamp: () => 'SERVER',
  setDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    if (ref.path.startsWith('clientRoleDiagnostics/')) scene.diagnosticWrites.push(data)
    else if (ref.path.startsWith('deviceSessions/')) scene.link = String(data.linkToken)
  },
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  where: (field: string, operator: string, value: unknown) => ({ field, operator, value }),
  query: (ref: { path: string }, ...constraints: unknown[]) => ({ ...ref, constraints }),
  getDocs: async () => ({ docs: [{ id: 'family' }] }),
  getDoc: async (ref: { path: string }) => {
    if (scene.forbidPrevious && ref.path.startsWith('users/previous-person')) throw Object.assign(new Error('Old identity has no access'), { code: 'permission-denied' })
    const data = ref.path.startsWith('deviceSessions/') ? { linkToken: scene.link }
      : ref.path.startsWith('accessLinks/') ? { active: true, personId: scene.personId }
        : ref.path.includes('/members/') ? { active: true, role: scene.role, childIds: ['child'] }
          : ref.path.includes('/shortcuts/') ? { dashboardToken: scene.role === 'parent' ? 'parent-dashboard' : 'shared-dashboard', dashboardTokens: { parent: 'parent-dashboard', student: 'shared-dashboard' } }
            : { displayName: 'Person' }
    return { exists: () => true, data: () => data, metadata: { fromCache: false } }
  },
  onSnapshot: (ref: { path: string; constraints?: { field: string; operator: string; value: unknown }[] }, options: unknown, callback?: (snapshot: unknown) => void) => {
    const changed = typeof options === 'function' ? options as (snapshot: unknown) => void : callback!
    if (ref.path === 'publicOlympiadCatalog' || ref.path === 'families/family/children/child/olympiadSelections') { changed({ docs: [], metadata: { fromCache: false } }); return () => {} }
    if (ref.path === 'families/family/children/child/tasks') {
      if (ref.constraints?.length !== 1 || ref.constraints[0].field !== 'learningContext.kind' || ref.constraints[0].operator !== '==' || ref.constraints[0].value !== 'olympiad') throw new Error('Unexpected family task query')
      changed({ docs: [], metadata: { fromCache: false } })
      return () => {}
    }
    scene.callbacks.set(ref.path, changed)
    const data = ref.path === 'families/family/children/child' ? { olympiadEligibility: { verified:true, grade:6 } } : ref.path.startsWith('accessLinks/') ? { active: true, personId: scene.personId }
      : ref.path.startsWith('deviceSessions/') ? { linkToken: scene.link } : { active: true, role: scene.role, childIds: ['child'], ...(scene.diagnostics ? { accessDiagnosticsUntil: { toMillis: () => Date.now() + 60000 } } : {}) }
    changed({ exists: () => true, data: () => data, metadata: { fromCache: false } }); return () => { if (scene.callbacks.get(ref.path) === changed) scene.callbacks.delete(ref.path) }
  },
}))
vi.mock('@/lib/dayDashboardStore', () => ({
  clearCachedDayDashboard: vi.fn(), readCachedDayDashboard: () => null,
  watchDayDashboard: (token: string, changed: (data: object) => void) => {
    const role = token === 'parent-dashboard' ? 'parent' : 'student'
    changed({ schemaVersion: 1, kind: role, today: '2026-10-18', timezone: 'Europe/Moscow', days: [{ date: '2026-10-18', schedule: [], homework: [], dayToken: null }],
      weekendWork: [{ dates: ['2026-10-18'], dayToken: `${role}-day`, taskIds: ['sheet'], title: 'Спецкурс', lessonDate: '2026-10-22', dueDate: '2026-10-22' }] })
    return () => {}
  },
}))
function page(token: string): DayPageData {
  return { kind: token === 'parent-day' ? 'parent' : 'student', date: '2026-10-21', targetDate: '2026-10-22', familyId: 'family', childId: 'child', studentToken: 'student-day',
    subjects: [{ id: 'special', name: 'Спецкурс', icon: '∑', summary: '', mesh: 'Реши сколько получится', materials: '', tasks: [{ id: 'sheet', title: 'Комбинаторика', detail: 'Реши сколько получится', kind: 'written', source: 'МЭШ', status: 'unknown',
      problems: [{ id: 'problem', number: 1, title: 'Книги на разных полках', detail: 'Выбрать пару книг', original: { text: 'Выбрать пару книг с разных полок', attachmentRef: 'sheet' }, source: 'Лист учителя', support: { skill: 'Выбор пары', state: 'unknown', evidence: 'Лист', evidenceRefs: ['sheet'], facts: [{ label: 'Полка 1', value: '10 книг' }], find: 'Число пар', firstQuestion: 'Какие пары полок возможны?', revision: 1 } }],
    }] }], notices: [], gradeSummary: [], todaySchedule: [], targetSchedule: [], boardToken: 'board', meshFetchedAt: '', materialLinks: {} }
}
vi.mock('@/lib/dayStore', async (original) => ({
  ...await original<typeof import('@/lib/dayStore')>(),
  watchDayPage: (token: string, changed: (page: DayPageData) => void) => { changed(page(token)); return () => {} },
  watchDayHelp: (_tokens: string[], changed: (value: unknown[]) => void) => { changed([]); return () => {} },
  watchDayUploads: (_tokens: string[], changed: (value: unknown[]) => void) => { changed([]); return () => {} },
  watchEvidenceDayPages: (_tokens: string[], changed: (value: unknown[]) => void) => { changed([]); return () => {} },
  watchDayReviews: (_tokens: string[], changed: (value: DayWorkReview[]) => void, _error: unknown, parent: boolean) => {
    scene.reviewRoles.push(parent); scene.reviewListeners.add(changed); changed(scene.reviews); return () => { scene.reviewListeners.delete(changed) }
  },
  watchDayTaskGuides: (token: string, changed: (value: object) => void, failed: (error: unknown) => void) => {
    scene.guideReads.push(token)
    if (scene.role !== 'parent') { failed({ code: 'permission-denied' }); return () => {} }
    changed({ problem: { guide: { kind: 'worked-solution', overview: 'Три независимых случая', revision: 1, presentation: 'math-route', stages: [
      { id: 'cases', role: 'solution', title: 'Случаи и подсчёт', expected: 'Три пары полок', rows: [], source: { kind: 'teacher-file', label: 'Лист', ref: 'sheet', excerpt: 'С разных полок' } },
      { id: 'answer', role: 'answer', title: 'Ответ и проверка', expected: 'Проверка', rows: [], answer: '1100', verification: [{ value: 'Проверка' }], source: { kind: 'teacher-file', label: 'Лист', ref: 'sheet', excerpt: 'Число пар' } },
    ] } } }); return () => {}
  },
}))
vi.mock('@/lib/parentCompletion', async (original) => ({ ...await original<typeof import('@/lib/parentCompletion')>(),
  watchParentCompletions: (_tokens: string[], changed: (events: unknown[]) => void) => { changed([]); return () => {} },
}))
import LearningRoute from './LearningRoute'
import { clearPersonalSession, rememberPersonalContext, readCachedPersonalContext } from '@/lib/personalAccess'
import { exportAccessDiagnostics, inspectAccessTrace } from '@/lib/browserAccessTrace'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Array<() => void> = []
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-18T09:00:00Z'))
  localStorage.clear(); sessionStorage.clear(); scene.reviews = []; scene.guideReads = []; scene.reviewRoles = []; scene.reviewListeners.clear(); scene.diagnostics = false; scene.diagnosticWrites = []
  clearPersonalSession(); scene.callbacks.clear(); scene.personId = 'person'; scene.forbidPrevious = false
})
afterEach(async () => { await act(async () => roots.splice(0).forEach((close) => close())); vi.useRealTimers() })
async function render(role: 'parent' | 'student', options: { cold?: boolean; cachedRole?: 'parent' | 'student'; staleIdentity?: boolean; expired?: boolean } = {}) {
  scene.role = role
  scene.link = (role === 'parent' ? 'p' : 's').repeat(43)
  const cachedRole = options.cachedRole ?? role
  scene.profile = { personId: 'person', displayName: 'Person', children: [{ familyId: 'family', childId: 'child', displayName: 'Child', role: cachedRole, dashboardToken: `${cachedRole}-dashboard`, dashboardTokens: { parent: 'parent-dashboard', student: 'shared-dashboard' } }] }
  if (options.staleIdentity) scene.profile.personId = 'previous-person'
  if (!options.cold) rememberPersonalContext({ session: { personId: scene.profile.personId, deviceUid: 'device', linkToken: options.staleIdentity ? 'o'.repeat(43) : scene.link }, profile: scene.profile })
  if (options.expired) {
    scene.forbidPrevious = true
    localStorage.setItem('education-personal-context-v1', JSON.stringify({ ...readCachedPersonalContext(), savedAt: Date.now() - 31 * 60_000 }))
  }
  history.replaceState(null, '', '/#/days/shared-dashboard')
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  roots.push(() => { root.unmount(); host.remove() })
  await act(async () => root.render(<LearningRoute mode="days" token="shared-dashboard" />))
  await act(async () => host.querySelector<HTMLButtonElement>('.problem-group-toggle')?.click())
  return host
}
describe('shared calendar with the actual weekend task composition', () => {
  it('characterizes the supplied incident: local student and confirmed server student produce the student card, not a parent rendering defect', async () => {
    const host = await render('student')
    const receipt = JSON.parse(await exportAccessDiagnostics())
    expect(receipt.events.some((row: any) => row.event === 'access.resolved' && row.detail.source === 'member-server' && row.detail.role === 'student' && row.detail.fromCache === false)).toBe(true)
    expect(inspectAccessTrace(receipt).findings).toContain('student-membership-student-view')
    expect(inspectAccessTrace(receipt).findings).not.toContain('parent-context-student-view')
    expect(host.textContent).toContain('Загрузить решение')
    expect(host.textContent).not.toContain('Разбор для родителя')
  })
  it.each(['parent', 'student'] as const)('recovers %s when the expired old profile is denied before access listeners can mount', async (role) => {
    const host = await render(role, { cachedRole: role === 'parent' ? 'student' : 'parent', staleIdentity: true, expired: true })
    expect(host.textContent).toContain(role === 'parent' ? 'Разбор для родителя' : 'Загрузить решение')
    expect(readCachedPersonalContext()?.session.personId).toBe('person')
    expect(host.textContent).not.toContain(role === 'parent' ? 'Загрузить решение' : 'Разбор для родителя')
  })
  it.each(['parent', 'student'] as const)('recovers the server-bound %s identity from an opposite stale browser login without a new link', async (role) => {
    const host = await render(role, { cachedRole: role === 'parent' ? 'student' : 'parent', staleIdentity: true })
    expect(host.textContent).toContain(role === 'parent' ? 'Разбор для родителя' : 'Загрузить решение')
    expect(host.textContent).not.toContain(role === 'parent' ? 'Загрузить решение' : 'Разбор для родителя')
    expect(readCachedPersonalContext()?.session.personId).toBe('person')
    expect(readCachedPersonalContext()?.profile.children[0].role).toBe(role)
    expect(host.textContent).not.toContain('Откройте свою личную ссылку')
    expect(location.hash).toBe('#/days/shared-dashboard')
  })
  it('still closes a genuinely revoked current parent session without exposing a student fallback', async () => {
    const host = await render('parent')
    await act(async () => scene.callbacks.get('families/family/members/person')!({ exists: () => true, data: () => ({ active: false }), metadata: { fromCache: false } }))
    expect(readCachedPersonalContext()).toBeNull()
    expect(host.textContent).not.toContain('Разбор для родителя')
    expect(host.textContent).not.toContain('Добавить фото')
    expect(host.textContent).toContain('Доступ изменился')
  })
  it.each(['parent', 'student'] as const)('restores %s from the device/grant/profile graph with no local cache', async (role) => {
    const host = await render(role, { cold: true })
    expect(host.textContent).toContain(role === 'parent' ? 'Разбор для родителя' : 'Загрузить решение')
    expect(host.textContent).not.toContain(role === 'parent' ? 'Загрузить решение' : 'Разбор для родителя')
    expect(readCachedPersonalContext()?.profile.children[0].role).toBe(role)
  })
  it.each(['parent', 'student'] as const)('reconciles an opposite stale cached role to %s through the real profile reader', async (role) => {
    const host = await render(role, { cachedRole: role === 'parent' ? 'student' : 'parent' })
    expect(host.textContent).toContain(role === 'parent' ? 'Разбор для родителя' : 'Загрузить решение')
    expect(host.textContent).not.toContain(role === 'parent' ? 'Загрузить решение' : 'Разбор для родителя')
    expect(readCachedPersonalContext()?.profile.children[0].role).toBe(role)
  })
  it.each((['parent', 'student'] as const).flatMap(nextRole => (['device', 'grant', 'member'] as const).flatMap(signal => [false, true].map(storageFirst => ({ nextRole, signal, storageFirst })))))('keeps the new $nextRole identity through an old $signal callback (storageFirst=$storageFirst)', async ({ nextRole, signal, storageFirst }) => {
    const host = await render(nextRole === 'parent' ? 'student' : 'parent')
    const path = signal === 'device' ? 'deviceSessions/device' : signal === 'grant' ? `accessLinks/${scene.link}` : 'families/family/members/person'
    const oldCallback = scene.callbacks.get(path)!
    expect(oldCallback).toBeTypeOf('function')
    scene.role = nextRole; scene.personId = `replacement-${nextRole}`; scene.link = (nextRole === 'parent' ? 'n' : 'c').repeat(43)
    const nextProfile: PersonalProfile = { personId: scene.personId, displayName: 'Replacement', children: [{ familyId: 'family', childId: 'child', displayName: 'Child', role: nextRole, dashboardToken: nextRole === 'parent' ? 'parent-dashboard' : 'shared-dashboard', dashboardTokens: { parent: 'parent-dashboard', student: 'shared-dashboard' } }] }
    localStorage.setItem('education-personal-context-v1', JSON.stringify({ session: { personId: scene.personId, deviceUid: 'device', linkToken: scene.link }, profile: nextProfile, savedAt: Date.now() }))
    if (storageFirst) await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'education-personal-context-v1' })))
    await act(async () => oldCallback({ exists: () => signal !== 'grant', data: () => signal === 'device' ? { linkToken: scene.link } : { active: false }, metadata: { fromCache: false } }))
    expect(readCachedPersonalContext()?.session.personId).toBe(scene.personId)
    const group = host.querySelector<HTMLButtonElement>('.problem-group-toggle')
    if (group?.getAttribute('aria-expanded') === 'false') await act(async () => group.click())
    expect(host.textContent).toContain(nextRole === 'parent' ? 'Разбор для родителя' : 'Загрузить решение')
    expect(host.textContent).not.toContain(nextRole === 'parent' ? 'Загрузить решение' : 'Разбор для родителя')
    if (nextRole === 'student') expect(host.textContent).not.toContain('1100')
    expect(host.textContent).not.toContain('Доступ изменился')
    expect(location.hash).toBe('#/days/shared-dashboard')
  })
  it('measures the actual parent leaf through the same member listener only when enabled', async () => {
    scene.diagnostics = true
    await render('parent')
    expect(scene.diagnosticWrites.length).toBeGreaterThan(0)
    expect(scene.diagnosticWrites.at(-1)).toMatchObject({ memberRole: 'parent', renderedRole: 'parent', hasGuide: true, familyId: 'family', childId: 'child' })
    expect(JSON.stringify(scene.diagnosticWrites)).not.toContain('1100')
  })
  it.each(['parent', 'student'] as const)('keeps %s actions throughout the whole composition on the same URL', async (role) => {
    const host = await render(role)
    expect(host.querySelector('.problem-card')).not.toBeNull()
    if (role === 'parent') {
      expect(host.textContent).toContain('Разбор для родителя')
      expect(host.textContent).toContain('Случаи и подсчёт')
      expect(host.textContent).not.toContain('Добавить фото')
      expect(host.textContent).not.toContain('Нужен ориентир?')
      expect(scene.guideReads).toEqual(['student-day'])
      expect(scene.reviewRoles).toEqual([true])
    } else {
      expect(host.textContent).toContain('Загрузить решение')
      expect(host.textContent).toContain('Нужен ориентир?')
      expect(host.textContent).not.toContain('Разбор для родителя')
      expect(host.textContent).not.toContain('1100')
      expect(scene.guideReads).toEqual([])
      expect(scene.reviewRoles).toEqual([false])
    }
    expect(location.hash).toBe('#/days/shared-dashboard')
  })
  it('receives a published review on the open parent weekend card without switching to student actions', async () => {
    const host = await render('parent')
    await act(async () => {
      scene.reviews = [{ id: 'review', taskId: 'problem', status: 'verified', summary: 'Ответ и ход подтверждены', uploadIds: [] }]
      scene.reviewListeners.forEach((changed) => changed(scene.reviews))
    })
    expect(host.querySelector('.problem-card.verified')).not.toBeNull()
    expect(host.querySelector('.problem-card-state')?.textContent).toBe('Проверено')
    expect(host.textContent).toContain('Разбор для родителя')
    expect(host.textContent).not.toContain('Добавить фото')
  })
})
