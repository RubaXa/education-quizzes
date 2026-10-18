// @vitest-environment jsdom
// @see ../docs/modules/school-diary/dashboard.md#weekend-work-contract
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DayPageData } from './lib/dayStore'
import type { ParentCompletionEvent } from './lib/parentCompletion'
import WeekendMathSlot from './WeekendMathSlot'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const scene = vi.hoisted(() => ({ page: null as DayPageData | null, role: 'parent', decisions: [] as ParentCompletionEvent[] }))
vi.mock('./lib/dayStore', async (original) => ({
  ...await original<typeof import('./lib/dayStore')>(),
  watchDayPage: (_token: string, changed: (page: DayPageData) => void) => { changed(scene.page!); return () => {} },
  watchDayHelp: (_tokens: string[], changed: (items: unknown[]) => void) => { changed([]); return () => {} },
  watchDayTaskGuides: (_token: string, changed: (items: object) => void) => { changed({}); return () => {} },
}))
vi.mock('./lib/personalAccess', () => ({ dayHelpSessionRole: async () => scene.role }))
vi.mock('./lib/useDayEvidence', () => ({ useDayEvidence: () => ({ studentToken: 'student-token', evidenceKey: 'student-token', uploads: [], reviews: [], ready: true }) }))
vi.mock('./lib/useParentCompletions', () => ({ useParentCompletions: () => ({ events: scene.decisions, ready: true }) }))
vi.mock('./components/ProblemTaskCard', () => ({ default: ({ problem }: { problem: { id: string; title: string } }) => <article data-problem={problem.id}>{problem.title}</article> }))

beforeEach(() => {
  scene.role = 'parent'
  scene.decisions = []
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
      expect(host.textContent).toContain('Задачи по выбору · 8')
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
