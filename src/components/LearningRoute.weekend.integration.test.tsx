// @vitest-environment jsdom
/** Real route → dashboard → weekend → problem → guide/review composition.
 * @see ../../docs/modules/families/access-and-state.md#authenticated-learning-routes */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersonalProfile } from '@/lib/personalAccess'
import type { DayPageData, DayWorkReview } from '@/lib/dayStore'

const scene = vi.hoisted(() => ({ role: 'parent' as 'parent' | 'student', profile: null as PersonalProfile | null, reviews: [] as DayWorkReview[], guideReads: [] as string[], reviewRoles: [] as boolean[], reviewListeners: new Set<(reviews: DayWorkReview[]) => void>(), diagnostics: false, diagnosticWrites: [] as Record<string, unknown>[] }))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'device' }, authStateReady: async () => {} }) }))
vi.mock('firebase/firestore', () => ({
  serverTimestamp: () => 'SERVER',
  setDoc: async (_ref: unknown, data: Record<string, unknown>) => { scene.diagnosticWrites.push(data) },
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  onSnapshot: (ref: { path: string }, _options: unknown, changed: (snapshot: unknown) => void) => {
    const data = ref.path.startsWith('accessLinks/') ? { active: true, personId: 'person' }
      : ref.path.startsWith('deviceSessions/') ? { linkToken: 'secret' } : { active: true, role: scene.role, childIds: ['child'], ...(scene.diagnostics ? { accessDiagnosticsUntil: { toMillis: () => Date.now() + 60000 } } : {}) }
    changed({ exists: () => true, data: () => data, metadata: { fromCache: false } }); return () => {}
  },
}))
vi.mock('@/lib/personalAccess', async (original) => ({
  watchPersonalContextChanges: (await original<typeof import('@/lib/personalAccess')>()).watchPersonalContextChanges,
  restorePersonalContext: async () => ({ session: { personId: 'person', deviceUid: 'device', linkToken: 'secret' }, profile: scene.profile }),
  loadPersonalProfile: async () => scene.profile,
  rememberPersonalContext: vi.fn(), rememberPersonalDashboardRoute: vi.fn(), clearPersonalSession: vi.fn(),
  currentEducationPersonId: () => 'person', readCachedPersonalContext: () => null, dayHelpSessionRole: async () => scene.role,
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
  watchDayTaskGuides: (token: string, changed: (value: object) => void) => {
    scene.guideReads.push(token)
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

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Array<() => void> = []
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-18T09:00:00Z'))
  localStorage.clear(); sessionStorage.clear(); scene.reviews = []; scene.guideReads = []; scene.reviewRoles = []; scene.reviewListeners.clear(); scene.diagnostics = false; scene.diagnosticWrites = []
})
afterEach(async () => { await act(async () => roots.splice(0).forEach((close) => close())); vi.useRealTimers() })
async function render(role: 'parent' | 'student') {
  scene.role = role
  scene.profile = { personId: 'person', displayName: 'Person', children: [{ familyId: 'family', childId: 'child', displayName: 'Child', role, dashboardToken: `${role}-dashboard`, dashboardTokens: { parent: 'parent-dashboard', student: 'shared-dashboard' } }] }
  history.replaceState(null, '', '/#/days/shared-dashboard')
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  roots.push(() => { root.unmount(); host.remove() })
  await act(async () => root.render(<LearningRoute mode="days" token="shared-dashboard" />))
  await act(async () => host.querySelector<HTMLButtonElement>('.problem-group-toggle')!.click())
  return host
}
describe('shared calendar with the actual weekend task composition', () => {
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
      expect(host.textContent).toContain('Добавить фото решения')
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
