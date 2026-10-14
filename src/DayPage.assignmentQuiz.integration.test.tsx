// @vitest-environment jsdom
// @see ../docs/product/day-page.md#numbered-sheet-and-quiz
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DayPageData, DayUpload, DayWorkReview } from './lib/dayStore'
import type { ParentCompletionEvent } from './lib/parentCompletion'
import DayPage from './DayPage'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const scene = vi.hoisted(() => ({
  page: null as DayPageData | null,
  role: 'parent' as 'parent' | 'student',
  reviews: [] as DayWorkReview[],
  uploads: [] as DayUpload[],
  decisions: [] as ParentCompletionEvent[],
  choiceCalls: [] as boolean[],
}))

vi.mock('./lib/dayStore', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/dayStore')>(),
  watchDayPage: (_token: string, onChange: (page: DayPageData) => void) => {
    if (scene.page) onChange({ ...scene.page, kind: scene.role })
    return () => {}
  },
  watchDayHelp: (_tokens: string[], onChange: (items: unknown[]) => void) => { onChange([]); return () => {} },
  watchDayTaskGuides: (_token: string, onChange: (guides: Record<string, unknown>) => void) => { onChange({}); return () => {} },
}))
vi.mock('./lib/dayGuidance', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/dayGuidance')>(),
  watchDayGuidance: (_token: string, onChange: (items: unknown[]) => void) => { onChange([]); return () => {} },
}))
vi.mock('./lib/personalAccess', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/personalAccess')>(),
  dayHelpSessionRole: async () => scene.role,
}))
vi.mock('./lib/useDayEvidence', () => ({
  useDayEvidence: () => ({ studentToken: 'student-token', evidenceKey: 'student-token',
    uploads: scene.uploads, reviews: scene.reviews, evidencePages: [], ready: true }),
}))
vi.mock('./lib/useParentCompletions', () => ({
  useParentCompletions: () => ({ events: scene.decisions, ready: true, error: '' }),
}))
vi.mock('./lib/useDayQuizOutcomes', () => ({
  useDayQuizOutcomes: () => ({
    boardEntries: [{ token: 'diagrams-test', testId: 'quiz-1', title: 'Диаграммы — тренировка', subject: 'Математика', slug: 'diagrams' }],
    tests: { 'diagrams-test': { testId: 'quiz-1', status: 'open', title: 'Диаграммы — тренировка', subject: 'Математика',
      description: 'Самопроверка по теме.', questions: Array.from({ length: 20 }, (_, index) => ({ id: `q-${index}` })), answers: {} } },
    scores: {}, ready: true,
  }),
}))
vi.mock('./lib/parentCompletion', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/parentCompletion')>(),
  recordVariantChoice: async (_token: string, taskId: string, variantId: string, required: boolean) => {
    scene.choiceCalls.push(required)
    scene.decisions = [...scene.decisions, { id: `choice-${scene.decisions.length + 1}`, taskId, variantId,
      action: required ? 'variant-required' : 'variant-optional', reviewCheckedAt: null,
      decidedAt: { seconds: 200 + scene.decisions.length, nanoseconds: 0 } }]
  },
}))

const taskId = 'mesh-diagrams'
const first = `${taskId}-v1`
const second = `${taskId}-v2`
const firstProblemIds = Array.from({ length: 5 }, (_, index) => `${first}-p${index + 1}`)

function page(): DayPageData {
  const problems = [first, second].flatMap((variantId) => Array.from({ length: 5 }, (_, index) => ({
    id: `${variantId}-p${index + 1}`, number: index + 1,
    title: index === 0 ? 'Марки Ивана' : `Задача ${index + 1}`, detail: '', source: 'Лист учителя', variantId,
    original: { text: `№ ${index + 1}. Постройте диаграмму.`, attachmentRef: 'teacher-sheet' },
  })))
  return {
    kind: 'parent', date: '2026-10-14', targetDate: '2026-10-14', meshFetchedAt: '2026-10-14T10:00:00.000Z',
    studentToken: 'student-token', boardToken: 'board-token', notices: [], todaySchedule: [], targetSchedule: [],
    gradeSummary: [{ id: 'math', name: 'Математика', average: 4.56 }],
    subjects: [{ id: 'math', name: 'Математика', icon: '∑', materials: '', mesh: 'Подготовиться к самостоятельной.', summary: '',
      tasks: [{ id: taskId, kind: 'check', status: 'unknown', title: 'Подготовиться к самостоятельной: диаграммы',
        detail: '', source: 'МЭШ', meshText: 'Подготовиться к самостоятельной по круговым и столбчатым диаграммам. Файл приложен.',
        testToken: 'diagrams-test', practiceVariants: [{ id: first, title: 'Вариант 1' }, { id: second, title: 'Вариант 2' }], problems }] }],
    testPlacements: [{ token: 'diagrams-test', subjectId: 'math', taskId }],
    materialLinks: { [taskId]: [{ title: 'Лист учителя', sourceType: 'teacher-attachment', url: 'https://disk.yandex.ru/d/example', sourceRef: 'teacher-sheet' }] },
  }
}

beforeEach(() => {
  scene.page = page()
  scene.role = 'parent'
  scene.reviews = firstProblemIds.map((id) => ({ id: `review-${id}`, taskId: id, status: 'verified', uploadIds: ['photo-1'] }))
  scene.uploads = [{ id: 'student-token:photo-1', taskId: firstProblemIds[0], coveredTaskIds: firstProblemIds, status: 'reviewed' }]
  scene.decisions = [{ id: 'optional', taskId, variantId: second, action: 'variant-optional', reviewCheckedAt: null,
    decidedAt: { seconds: 100, nanoseconds: 0 } }]
  scene.choiceCalls = []
  sessionStorage.clear()
  sessionStorage.setItem('education-day-initial-tab', 'homework')
})

async function renderPage(parent: boolean) {
  scene.role = parent ? 'parent' : 'student'
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(<DayPage token="student-token" parent={parent} headerReturnTarget={null} />) })
  return { host, root, cleanup: async () => { await act(async () => root.unmount()); host.remove() } }
}

describe('day page: teacher sheet and linked self-check', () => {
  it('keeps a reading-only assignment in one quiz card with the exact instruction', async () => {
    const reading = page()
    reading.subjects[0].tasks[0] = { id: taskId, kind: 'read', status: 'unknown', title: 'Прочитать параграф',
      detail: '', source: 'МЭШ', meshText: 'Прочитать § 7.', testToken: 'diagrams-test' }
    reading.materialLinks = {}
    scene.page = reading
    const view = await renderPage(true)
    try {
      expect(view.host.querySelectorAll('.day-quiz-lineage')).toHaveLength(1)
      expect(view.host.querySelectorAll('.day-task')).toHaveLength(0)
      expect(view.host.querySelector('.day-quiz-lineage')?.textContent).toContain('Прочитать § 7.')
    } finally { await view.cleanup() }
  })

  it('keeps a written task and pupil photo action beside its linked quiz', async () => {
    const written = page()
    written.subjects[0].tasks[0] = { id: taskId, kind: 'written', status: 'unknown', title: 'Решить примеры',
      detail: '', source: 'МЭШ', meshText: 'Решить № 1–5 в тетради.', testToken: 'diagrams-test' }
    written.materialLinks = {}
    scene.page = written
    const view = await renderPage(false)
    try {
      expect(view.host.querySelectorAll('.day-quiz-lineage')).toHaveLength(1)
      expect(view.host.querySelectorAll('.day-task')).toHaveLength(1)
      expect(view.host.querySelector('.day-task')?.textContent).toContain('Решить № 1–5 в тетради.')
      expect(view.host.querySelector('.day-task .day-upload input[type="file"]')).not.toBeNull()
    } finally { await view.cleanup() }
  })

  it('keeps the teacher sheet beside the quiz, with the optional variant reversible', async () => {
    const view = await renderPage(true)
    try {
      expect(view.host.querySelectorAll('.day-quiz-lineage')).toHaveLength(1)
      expect(view.host.querySelector('.day-quiz-lineage-score')?.textContent).toBe('0 из 20')
      expect(view.host.querySelectorAll('.problem-group')).toHaveLength(1)
      expect(view.host.querySelector('.day-subject-assignment-count')?.textContent).toContain('Задачи: 5 из 5')
      expect(view.host.querySelector('.day-quiz-lineage .day-assignment-brief')).toBeNull()
      await act(async () => { view.host.querySelector<HTMLButtonElement>('.problem-group-toggle')?.click() })
      expect(view.host.querySelector('.day-teacher-sheet')?.textContent).toContain('Лист учителя')
      expect(view.host.querySelectorAll('.day-practice-variant')).toHaveLength(2)
      expect(view.host.querySelectorAll('.day-practice-variant-problems .problem-card')).toHaveLength(10)
      const switches = view.host.querySelectorAll<HTMLButtonElement>('.day-practice-variant-shell [role="switch"]')
      expect(switches).toHaveLength(2)
      expect(switches[1].getAttribute('aria-checked')).toBe('false')
      await act(async () => { switches[1].click() })
      await act(async () => { view.root.render(<DayPage token="student-token" parent headerReturnTarget={null} />) })
      expect(scene.choiceCalls).toEqual([true])
      expect(view.host.querySelector('.day-subject-assignment-count')?.textContent).toContain('Задачи: 5 из 10')
      const enabledSwitch = view.host.querySelectorAll<HTMLButtonElement>('.day-practice-variant-shell [role="switch"]')[1]
      expect(enabledSwitch.getAttribute('aria-checked')).toBe('true')
      await act(async () => { enabledSwitch.click() })
      await act(async () => { view.root.render(<DayPage token="student-token" parent headerReturnTarget={null} />) })
      expect(scene.choiceCalls).toEqual([true, false])
      expect(view.host.querySelector('.day-subject-assignment-count')?.textContent).toContain('Задачи: 5 из 5')
      expect(view.host.querySelectorAll('.day-practice-variant')).toHaveLength(2)
    } finally { await view.cleanup() }
  })

  it('shows the same teacher sheet to the pupil without parent switches', async () => {
    const view = await renderPage(false)
    try {
      expect(view.host.querySelectorAll('.day-quiz-lineage')).toHaveLength(1)
      expect(view.host.querySelectorAll('.problem-group')).toHaveLength(1)
      await act(async () => { view.host.querySelector<HTMLButtonElement>('.problem-group-toggle')?.click() })
      expect(view.host.querySelectorAll('.day-practice-variant')).toHaveLength(2)
      expect(view.host.querySelectorAll('.day-practice-variant-shell [role="switch"]')).toHaveLength(0)
      expect(view.host.querySelectorAll('.day-practice-variant-shell')[1]?.textContent).toContain('По желанию')
    } finally { await view.cleanup() }
  })
})
