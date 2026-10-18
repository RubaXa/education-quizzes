// @vitest-environment jsdom
// @see ../docs/modules/school-diary/dashboard.md#weekend-work-contract
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DayPageData, DayUpload } from './lib/dayStore'
import type { ParentCompletionEvent } from './lib/parentCompletion'
import WeekendMathSlot from './WeekendMathSlot'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const scene = vi.hoisted(() => ({ page: null as DayPageData | null, role: 'parent', decisions: [] as ParentCompletionEvent[], uploads: [] as DayUpload[] }))
vi.mock('./lib/dayStore', async (original) => ({
  ...await original<typeof import('./lib/dayStore')>(),
  watchDayPage: (_token: string, changed: (page: DayPageData) => void) => { changed(scene.page!); return () => {} },
  watchDayHelp: (_tokens: string[], changed: (items: unknown[]) => void) => { changed([]); return () => {} },
  watchDayTaskGuides: (_token: string, changed: (items: object) => void) => { changed({}); return () => {} },
  uploadDayPhoto: vi.fn(async () => {}),
}))
vi.mock('./lib/personalAccess', () => ({ dayHelpSessionRole: async () => scene.role }))
vi.mock('./lib/dayGuidance', () => ({ watchDayGuidance: (_token: string, changed: (items: unknown[]) => void) => { changed([]); return () => {} }, sendDayGuidance: vi.fn() }))
vi.mock('./lib/useDayEvidence', () => ({ useDayEvidence: () => ({ studentToken: 'student-token', evidenceKey: 'student-token', uploads: scene.uploads, reviews: [], evidencePages: [], ready: true }) }))
vi.mock('./lib/useParentCompletions', () => ({ useParentCompletions: () => ({ events: scene.decisions, ready: true }) }))
vi.mock('./components/ProblemTaskCard', async (original) => {
  const { default: Actual } = await original<typeof import('./components/ProblemTaskCard')>()
  return { default: (props: Parameters<typeof Actual>[0]) => <article data-problem={props.problem.id}><Actual {...props} /></article> }
})

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:local-photo')
  URL.revokeObjectURL = vi.fn()
  scene.role = 'parent'
  scene.decisions = []
  scene.uploads = []
  scene.page = { targetDate: '2026-10-19', studentToken: 'student-token', subjects: [{ id: 'math', name: 'Математика', icon: '∑', summary: '', tasks: [{
    id: 'combinatorics', title: 'Комбинаторика', detail: 'Реши сколько получится', source: 'МЭШ', kind: 'check', status: 'unknown',
    practiceVariants: Array.from({ length: 8 }, (_, i) => ({ id: `v${i + 1}`, title: `№${i + 1}`, optionalByTeacher: { sourceRef: 'sheet', excerpt: 'Реши сколько получится' } })),
    problems: Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, variantId: `v${i + 1}`, number: i + 1, title: `Задача ${i + 1}`, detail: 'Условие', source: 'Лист учителя' })),
  }] }] } as DayPageData
})

async function renderSlot(parent = true) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<WeekendMathSlot token="same-source-page" taskIds={['combinatorics']} parent={parent} lessonDate="2026-10-19" dueDate="2026-10-19" title="Спецкурс · Комбинаторика" />))
  return { host, close: () => act(() => { root.unmount(); host.remove() }) }
}

describe('weekend source-selected practice', () => {
  it.each([false, true])('opens, switches and closes own reviewed photos without losing linked references, parent=%s', async (parent) => {
    scene.role = parent ? 'parent' : 'student'
    scene.uploads = [1, 2].map((n) => ({ id: `student-token:photo-${n}`, taskId: 'p1', coveredTaskIds: ['p1', 'p2'], status: 'reviewed', dataUrl: `data:image/png;base64,demo${n}` }))
    const { host, close } = await renderSlot(parent)
    try {
      await act(async () => host.querySelector<HTMLButtonElement>('.problem-group-toggle')!.click())
      const origin = host.querySelector('[data-problem="p1"]')!
      const photos = origin.querySelectorAll<HTMLButtonElement>('.day-upload-chip')
      expect(photos).toHaveLength(2)
      await act(async () => photos[0].click())
      expect(origin.querySelector('.day-upload-expanded img')?.getAttribute('src')).toContain('demo1')
      await act(async () => photos[1].click())
      expect(origin.querySelector('.day-upload-expanded img')?.getAttribute('src')).toContain('demo2')
      expect(origin.querySelectorAll('.day-upload-expanded')).toHaveLength(1)
      await act(async () => origin.querySelector<HTMLButtonElement>('[aria-label="Закрыть фото"]')!.click())
      expect(origin.querySelector('.day-upload-expanded')).toBeNull()
      expect(host.querySelector('[data-problem="p2"] .linked-work-photos')).not.toBeNull()
      expect(host.querySelector('[data-problem="p2"] .weekend-math-photos')).toBeNull()
    } finally { close() }
  })
  it('opens a newly selected local photo before the upload snapshot arrives', async () => {
    scene.role = 'student'
    const { host, close } = await renderSlot(false)
    try {
      await act(async () => host.querySelector<HTMLButtonElement>('.problem-group-toggle')!.click())
      const origin = host.querySelector('[data-problem="p1"]')!
      const input = origin.querySelector<HTMLInputElement>('input[type="file"]')!
      Object.defineProperty(input, 'files', { value: [new File(['photo'], 'work.png', { type: 'image/png' })] })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
      const photo = origin.querySelector<HTMLButtonElement>('.day-upload-chip')
      expect(photo).not.toBeNull()
      await act(async () => photo!.click())
      expect(origin.querySelector('.day-upload-expanded img')?.getAttribute('src')).toBe('blob:local-photo')
    } finally { close() }
  })
  it.each([false, true])('keeps an upload in its original task after coverage excludes that origin, parent=%s', async (parent) => {
    scene.role = parent ? 'parent' : 'student'
    scene.uploads = [{ id: 'student-token:photo', taskId: 'p1', processingTaskIds: ['p2'], status: 'pending' }]
    const { host, close } = await renderSlot(parent)
    try {
      await act(async () => host.querySelector<HTMLButtonElement>('.problem-group-toggle')!.click())
      expect(host.querySelector('[data-problem="p1"] .weekend-math-photos')).not.toBeNull()
      expect(host.querySelector('[data-problem="p2"] .weekend-math-photos')).toBeNull()
      expect(host.querySelector('[data-problem="p2"] .linked-work-photos')?.textContent).toContain('Задача 1')
      expect(host.querySelector('[data-problem="p2"] .linked-work-photos .artifact-avatar')).toBeNull()
      expect(host.querySelector('[data-problem="p2"] .day-review-progress')?.textContent).toContain('ждёт проверки')
    } finally { close() }
  })
  it.each([true, false])('keeps all eight numbers visible and optional for parent=%s', async (parent) => {
    scene.role = parent ? 'parent' : 'student'
    const { host, close } = await renderSlot(parent)
    try {
      const toggle = host.querySelector<HTMLButtonElement>('.problem-group-toggle')!
      expect(toggle.textContent).toContain('По желанию')
      expect(toggle.getAttribute('aria-label')).toContain('все варианты по желанию')
      expect(host.textContent).toContain('урок 19 октября · сдать 19 октября')
      await act(async () => toggle.click())
      expect(host.querySelectorAll('[data-problem]')).toHaveLength(8)
      expect(host.textContent).toContain('Реши сколько получится · по выбору учителя')
      expect(host.textContent).not.toContain('исключены из обязательного семейного плана')
    } finally { close() }
  })
  it('counts the same explicit family inclusion as the detailed day while retaining every number', async () => {
    scene.decisions = [{ id: 'include-v3', taskId: 'combinatorics', variantId: 'v3', action: 'variant-required', reviewCheckedAt: null, decidedAt: { seconds: 1, nanoseconds: 0 } }] as ParentCompletionEvent[]
    const { host, close } = await renderSlot()
    try {
      expect(host.querySelector('.problem-group-toggle')?.textContent).toContain('0 из 1')
      await act(async () => host.querySelector<HTMLButtonElement>('.problem-group-toggle')!.click())
      expect(host.querySelectorAll('[data-problem]')).toHaveLength(8)
    } finally { close() }
  })
  it('preserves the required default for older variants without a teacher choice', async () => {
    scene.page!.subjects[0].tasks[0].practiceVariants!.forEach((variant) => { delete variant.optionalByTeacher })
    const { host, close } = await renderSlot()
    try { expect(host.querySelector('.problem-group-toggle')?.textContent).toContain('0 из 8') }
    finally { close() }
  })
})
