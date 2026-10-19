// @vitest-environment jsdom
/** @see ../docs/modules/reviews/subject-aware-guidance.md#math-route */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DayPageData, DayWorkReview, ParentTaskGuide } from './lib/dayStore'

const scene = vi.hoisted(() => ({ role: 'parent', events: [] as any[], inbox: [] as any[],
  listeners: new Set<(snapshot: any) => void>(), reads: [] as string[], guide: null as ParentTaskGuide | null,
  serverRevision: 1, fail: false, hold: false, commits: 0, stageChoices: [] as any[], reviews: [] as DayWorkReview[] }))
const page = { kind: 'parent', date: '2026-10-21', meshFetchedAt: '', notices: [], gradeSummary: [], todaySchedule: [], targetSchedule: [], boardToken: 'board', familyId: 'family', childId: 'child', targetDate: '2026-10-22', studentToken: 'source',
  subjects: [{ id: 'special', name: 'Спецкурс', icon: '∑', summary: '', mesh: '', materials: '', tasks: [{ id: 'sheet', title: 'Лист', kind: 'written', status: 'unknown', source: 'МЭШ', detail: 'Реши сколько получится',
    problems: [{ id: 'problem', number: 4, title: 'Слова', detail: 'Посчитать слова', source: 'Учитель', support: { revision: 1, skill: 'Выбор', state: 'unknown', evidence: 'Учитель', firstQuestion: 'Как выбрать?', evidenceRefs: [], facts: [], find: 'Число слов' } }],
  }] }] } as DayPageData
function snapshot() { return { docs: scene.events.map((event) => ({ id: event.id, data: () => event.data })) } }
vi.mock('./lib/firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'device' } }) }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  serverTimestamp: () => ({ seconds: 100, nanoseconds: 0 }),
  onSnapshot: (ref: { path: string }, changed: (value: any) => void) => {
    scene.reads.push(ref.path); scene.listeners.add(changed)
    if (!scene.hold) changed(snapshot())
    return () => { scene.listeners.delete(changed) }
  },
  getDocFromServer: async (ref: { path: string }) => {
    scene.reads.push(ref.path)
    const data = ref.path === 'dayTaskGuides/source/items/problem' ? { guide: { ...scene.guide, revision: scene.serverRevision } }
      : ref.path === 'dayOwners/source' ? { familyId: 'family', childId: 'child', targetDate: '2026-10-22' } : null
    return { exists: () => Boolean(data), data: () => data }
  },
  getDocs: async (ref: { path: string }) => {
    scene.reads.push(ref.path)
    return { docs: [
      { id: 'learner', data: () => ({ active: true, role: 'student', childIds: ['child'] }) },
      { id: 'other-child', data: () => ({ active: true, role: 'student', childIds: ['other'] }) },
      { id: 'adult', data: () => ({ active: true, role: 'parent', childIds: ['child'] }) },
      { id: 'inactive', data: () => ({ active: false, role: 'student', childIds: ['child'] }) },
    ] }
  },
  writeBatch: () => {
    const writes: any[] = []
    const batch = { set: (ref: { path: string }, data: any) => { writes.push({ path: ref.path, data }); return batch }, commit: async () => {
      scene.commits++
      if (scene.fail) throw new Error('Не удалось отправить')
      for (const write of writes) {
        if (write.path.startsWith('dayGuidance/')) scene.events.push({ id: write.path.split('/').at(-1), data: write.data })
        else scene.inbox.push(write)
      }
      scene.listeners.forEach((changed) => changed(snapshot()))
    } }
    return batch
  },
}))
vi.mock('./lib/personalAccess', () => ({ dayHelpSessionRole: async () => scene.role, currentEducationPersonId: () => 'adult' }))
vi.mock('./lib/dayStore', async (original) => ({ ...await original<typeof import('./lib/dayStore')>(),
  watchDayPage: (_token: string, changed: (value: DayPageData) => void) => { changed(page); return () => {} },
  watchDayHelp: (_tokens: string[], changed: (value: any[]) => void) => { changed([]); return () => {} },
  watchDayTaskGuides: (_token: string, changed: (value: object) => void) => { changed({ problem: { guide: scene.guide } }); return () => {} },
}))
vi.mock('./lib/useDayEvidence', () => ({ useDayEvidence: () => ({ studentToken: 'source', evidenceKey: 'source', uploads: [], reviews: scene.reviews, evidencePages: [], ready: true }) }))
vi.mock('./lib/useParentCompletions', () => ({ useParentCompletions: () => ({ events: [], ready: true }) }))
vi.mock('./lib/parentCompletion', async (original) => ({ ...await original<typeof import('./lib/parentCompletion')>(),
  recordStageChoice: async (...args: any[]) => { scene.stageChoices.push(args) },
}))
import WeekendMathSlot from './WeekendMathSlot'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const cleanup: Array<() => void> = []
beforeEach(() => {
  Object.defineProperty(globalThis.crypto, 'subtle', { value: webcrypto.subtle, configurable: true })
  scene.role = 'parent'; scene.events = []; scene.inbox = []; scene.reads = []; scene.listeners.clear()
  scene.serverRevision = 1; scene.fail = false; scene.hold = false; scene.commits = 0; scene.stageChoices = []; scene.reviews = []
  scene.guide = { revision: 1, presentation: 'math-route', kind: 'worked-solution', overview: 'Выбор', stages: [{
    id: 'choices', title: 'Два уровня выбора', role: 'solution', expected: 'Полный закрытый ход', rows: [],
    hintPreview: 'Чем могут различаться два слога?', revealPreview: 'Сначала 70 слогов, затем 70 × 70 слов.',
    source: { kind: 'teacher-file', label: 'Учитель', ref: 'sheet', excerpt: 'Любых двух слогов' },
  }] } as ParentTaskGuide
})
afterEach(async () => { await act(async () => cleanup.splice(0).forEach((close) => close())); expect(scene.listeners.size).toBe(0) })
async function render(parent = true) {
  scene.role = parent ? 'parent' : 'student'
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  cleanup.push(() => { root.unmount(); host.remove() })
  await act(async () => root.render(<WeekendMathSlot token={parent ? 'parent-page' : 'source'} taskIds={['sheet']} parent={parent} dueDate="2026-10-22" title="Спецкурс" />))
  await act(async () => host.querySelector<HTMLButtonElement>('.problem-group-toggle')!.click())
  return host
}
async function chooseHint(host: HTMLElement) {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Выбрать подсказку для этапа «Два уровня выбора»"]')!.click())
  return host.querySelector<HTMLButtonElement>('.day-learning-route-preview button')!
}
describe('weekend uses the complete parent guidance flow', () => {
  it('does not confuse another task release with the same stage id', async () => {
    scene.events = [{ id: 'other', data: { taskId: 'other-task', stageId: 'choices', level: 'hint', text: 'Чужая подсказка', createdAt: { seconds: 100 } } }]
    const parent = await render()
    expect((await chooseHint(parent)).disabled).toBe(false)
    const student = await render(false)
    expect(student.textContent).not.toContain('Чужая подсказка')
  })
  it('waits for existing releases before offering a new send', async () => {
    scene.hold = true
    const host = await render()
    expect(host.querySelector('[aria-label^="Выбрать подсказку"]')).toBeNull()
    await act(async () => scene.listeners.forEach((changed) => changed(snapshot())))
    expect((await chooseHint(host)).disabled).toBe(false)
  })
  it('keeps a failed send retryable without inventing a receipt', async () => {
    scene.fail = true
    const host = await render()
    const send = await chooseHint(host)
    await act(async () => { send.click(); await vi.waitFor(() => expect(scene.commits).toBe(1)) })
    expect(host.textContent).toContain('Не удалось отправить')
    expect(host.textContent).not.toContain('Помощь отправлена')
    expect(scene.events).toHaveLength(0); expect(scene.inbox).toHaveLength(0)
    expect(send.disabled).toBe(false)
    scene.fail = false
    await act(async () => { send.click(); await vi.waitFor(() => expect(scene.events).toHaveLength(1)) })
    expect(host.textContent).toContain('Подсказка отправлена')
  })
  it('refuses a stale prepared guide before writing any release or notification', async () => {
    scene.serverRevision = 2
    const host = await render()
    const send = await chooseHint(host)
    await act(async () => send.click())
    expect(host.textContent).toContain('Разбор изменился')
    expect(scene.events).toHaveLength(0); expect(scene.inbox).toHaveLength(0)
  })
  it('uses the same send command for a deliberately selected full step', async () => {
    const host = await render()
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label^="Выбрать показ полного шага"]')!.click())
    const send = host.querySelector<HTMLButtonElement>('.day-learning-route-preview button')!
    expect(send.disabled).toBe(false)
    await act(async () => { send.click(); await vi.waitFor(() => expect(scene.events).toHaveLength(1)) })
    expect(scene.events[0].data).toMatchObject({ level: 'reveal', text: scene.guide!.stages[0].revealPreview })
    expect(scene.inbox).toHaveLength(1)
  })
  it('allows sending the full step after the hint for the same stage', async () => {
    const host = await render()
    const hintSend = await chooseHint(host)
    await act(async () => { hintSend.click(); await vi.waitFor(() => expect(scene.events).toHaveLength(1)) })
    expect(host.querySelector('[aria-label^="Выбрать подсказку"]')).toBeNull()
    expect(host.querySelector('[aria-label^="Выбрать показ полного шага"]')).not.toBeNull()

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label^="Выбрать показ полного шага"]')!.click())
    const revealSend = host.querySelector<HTMLButtonElement>('.day-learning-route-preview button')!
    await act(async () => { revealSend.click(); await vi.waitFor(() => expect(scene.events).toHaveLength(2)) })
    expect(scene.events.map((event) => event.data.level)).toEqual(['hint', 'reveal'])
    expect(scene.events[1].data.text).toBe(scene.guide!.stages[0].revealPreview)
    expect(host.querySelector('[aria-label^="Выбрать показ"]')).toBeNull()
  })
  it('keeps an already released hint closed but leaves the full step available after reopening', async () => {
    scene.events = [{ id: 'old', data: { taskId: 'problem', stageId: 'choices', level: 'hint', text: scene.guide!.stages[0].hintPreview, guideRevision: 1, createdAt: { seconds: 100 } } }]
    const host = await render()
    expect(host.textContent).toContain('Подсказка отправлена')
    expect(host.querySelector('[aria-label^="Выбрать подсказку"]')).toBeNull()
    expect(host.querySelector('[aria-label^="Выбрать показ полного шага"]')).not.toBeNull()
    expect(scene.inbox).toHaveLength(0)
  })
  it('connects an existing checkable stage switch to the parent decision command', async () => {
    scene.guide!.presentation = 'learning-route'
    scene.reviews = [{ id: 'source:review', taskId: 'problem', status: 'partial', checkedAt: { seconds: 10, nanoseconds: 0 }, checkableStageIds: ['choices'], items: [{ label: 'Шаг', stageId: 'choices', status: 'partial' }] } as DayWorkReview]
    const host = await render()
    const control = host.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(control).not.toBeNull(); expect(control.disabled).toBe(false)
    await act(async () => control.click())
    expect(scene.stageChoices).toHaveLength(1)
    expect(scene.stageChoices[0]).toEqual([scene.reviews[0], scene.guide, 'choices', false])
  })
  it('sends an actual prepared hint and shows only that released text to the student', async () => {
    const parent = await render()
    const send = await chooseHint(parent)
    expect(send.disabled).toBe(false)
    await act(async () => { send.click(); await vi.waitFor(() => expect(scene.events).toHaveLength(1)) })
    expect(scene.events).toHaveLength(1)
    expect(scene.events[0].data).toMatchObject({ taskId: 'problem', stageId: 'choices', level: 'hint', text: scene.guide!.stages[0].hintPreview, actorPersonId: 'adult' })
    expect(scene.inbox).toHaveLength(1)
    expect(scene.reads).toContain('families/family/members')
    expect(scene.inbox[0]).toMatchObject({ path: `users/learner/inbox/${scene.events[0].id}`, data: { type: 'parent_guidance', taskId: 'problem', studentToken: 'source' } })
    expect(parent.textContent).toContain('Подсказка отправлена')
    expect(parent.querySelector('[aria-label^="Выбрать подсказку"]')).toBeNull()
    const student = await render(false)
    expect(student.textContent).toContain(scene.guide!.stages[0].hintPreview)
    expect(student.textContent).not.toContain('Полный закрытый ход')
    expect(student.textContent).not.toContain(scene.guide!.stages[0].revealPreview)
    expect(student.querySelector('.day-learning-route-preview')).toBeNull()
    expect(scene.reads.filter((path) => path === 'dayGuidance/source/items')).toHaveLength(2) // One per mounted page.
  })
})
