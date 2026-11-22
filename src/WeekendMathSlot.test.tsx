// @vitest-environment jsdom
// @see ../docs/modules/school-diary/dashboard.md#weekend-work-contract
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DayPageData, DayUpload, DayWorkReview } from './lib/dayStore'
import type { ParentCompletionEvent } from './lib/parentCompletion'
import WeekendMathSlot from './WeekendMathSlot'
import type { Assignment } from './lib/quiz'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const scene = vi.hoisted(() => ({ page: null as DayPageData | null, role: 'parent', decisions: [] as ParentCompletionEvent[], uploads: [] as DayUpload[], reviews: [] as DayWorkReview[] }))
const quizScene = vi.hoisted(() => ({ tests: {} as Record<string, Assignment>, scores: {} as Record<string, { points: number; maxPoints: number }>, ready: true }))
vi.mock('./lib/useDayQuizOutcomes', () => ({ useDayQuizOutcomes: () => ({ ...quizScene, boardEntries: [], results: {} }) }))
vi.mock('./lib/dayStore', async (original) => ({
  ...await original<typeof import('./lib/dayStore')>(),
  watchDayPage: (_token: string, changed: (page: DayPageData) => void) => { changed(scene.page!); return () => {} },
  watchDayHelp: (_tokens: string[], changed: (items: unknown[]) => void) => { changed([]); return () => {} },
  watchDayTaskGuides: (_token: string, changed: (items: object) => void) => { changed({}); return () => {} },
  uploadDayPhoto: vi.fn(async () => {}),
}))
vi.mock('./lib/personalAccess', () => ({ dayHelpSessionRole: async () => scene.role }))
vi.mock('./lib/dayGuidance', () => ({ watchDayGuidance: (_token: string, changed: (items: unknown[]) => void) => { changed([]); return () => {} }, sendDayGuidance: vi.fn() }))
vi.mock('./lib/useDayEvidence', () => ({ useDayEvidence: () => ({ studentToken: 'student-token', evidenceKey: 'student-token', uploads: scene.uploads, reviews: scene.reviews, evidencePages: [], ready: true }) }))
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
  scene.reviews = []
  quizScene.tests = {}
  quizScene.scores = {}
  quizScene.ready = true
  scene.page = { targetDate: '2026-10-19', studentToken: 'student-token', subjects: [{ id: 'math', name: 'Математика', icon: '∑', summary: '', tasks: [{
    id: 'combinatorics', title: 'Комбинаторика', detail: 'Реши сколько получится', source: 'МЭШ', kind: 'check', status: 'unknown',
    practiceVariants: Array.from({ length: 8 }, (_, i) => ({ id: `v${i + 1}`, title: `№${i + 1}`, optionalByTeacher: { sourceRef: 'sheet', excerpt: 'Реши сколько получится' } })),
    problems: Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, variantId: `v${i + 1}`, number: i + 1, title: `Задача ${i + 1}`, detail: 'Условие', source: 'Лист учителя' })),
  }] }] } as DayPageData
})

async function renderSlot(parent = true, options: { preparationThrough?: string; selectedDate?: string } = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<WeekendMathSlot token="same-source-page" taskIds={['combinatorics']} parent={parent} lessonDate="2026-10-19" dueDate="2026-10-19" title="Спецкурс · Комбинаторика" {...options} />))
  return { host, close: () => act(() => { root.unmount(); host.remove() }) }
}

describe('weekend source-selected practice', () => {
  it.each([false,true])('keeps the real teacher sheet and photo evidence beside its preparation test, parent=%s', async parent => {
    scene.role=parent?'parent':'student'
    const task=scene.page!.subjects[0].tasks[0]
    delete task.problems; delete task.practiceVariants
    task.testToken='quiz-token'
    task.assignmentUnits={version:1,sourceText:'Реши задачи из файла.',items:[{id:'sheet',title:'Лист учителя · страница 1',kind:'mixed',original:'Реши задачи из файла.',instructions:['Открой лист и добавь фото уже решённых задач.'],sourceRefs:['teacher#1']}]}
    scene.page!.materialLinks={combinatorics:[{sourceRef:'teacher#1',title:'Оригинал учителя',url:'data:image/png;base64,demo',sourceType:'teacher-attachment'}]}
    scene.uploads=[{id:'student-token:saved',taskId:'combinatorics',status:'reviewed',dataUrl:'data:image/png;base64,saved'} as DayUpload]
    const {host,close}=await renderSlot(parent)
    try {
      expect(host.textContent).toContain('Лист учителя · страница 1')
      expect(host.querySelectorAll('.day-upload-chip')).toHaveLength(1)
      expect(host.querySelectorAll('input[type=file]').length).toBe(parent?0:1)
    } finally {close()}
  })
  it('keeps submitted worksheet photos visible after a passed test and the preparation date',async()=>{
    scene.role='student'
    const task=scene.page!.subjects[0].tasks[0]
    delete task.problems;delete task.practiceVariants;task.testToken='quiz-token'
    quizScene.tests={'quiz-token':{testId:'test',title:'Проверка',subject:'Математика',status:'submitted',answers:{a:'1'},questions:[{id:'a',kind:'number',prompt:'Сколько?',points:1}]} as unknown as Assignment}
    quizScene.scores={'quiz-token':{points:1,maxPoints:1}}
    scene.uploads=[{id:'student-token:new',taskId:task.id,status:'pending'} as DayUpload]
    const {host,close}=await renderSlot(false,{preparationThrough:'2026-10-18',selectedDate:'2026-10-20'})
    try{expect(host.textContent).toContain('Комбинаторика')}finally{close()}
  })
  it.each([false,true])('keeps a missing-figure number outside the preparation obligation in both roles, parent=%s',async parent=>{
    scene.role=parent?'parent':'student'
    const task=scene.page!.subjects[0].tasks[0]
    task.kind='written';delete task.practiceVariants
    task.problems=task.problems!.slice(0,5).map(({variantId:_,...p})=>p)
    task.problems[1].original={text:'See the absent figure.',attachmentRef:'teacher#1'}
    task.problems[1].sourceGap={kind:'missing-figure',sourceRef:'teacher#1',reason:'The complete teacher PDF has no figure or dimensions.'}
    const {host,close}=await renderSlot(parent)
    try{
      expect(host.querySelector('.problem-group-toggle')?.getAttribute('aria-label')).toContain('обязательная часть 0 из 4')
      await act(async()=>host.querySelector<HTMLButtonElement>('.problem-group-toggle')!.click())
      expect(host.querySelectorAll('[data-problem]')).toHaveLength(5)
    }finally{close()}
  })
  it.each([false, true])('renders the same self-check without a photo demand and keeps pending written answers visible, parent=%s', async parent => {
    scene.role = parent ? 'parent' : 'student'
    scene.page = { targetDate: '2026-11-16', subjects: [{ id: 'russian', name: 'Русский язык', tasks: [{ id: 'control', kind: 'check', title: 'Лексикология', detail: 'Выполни на выходных', testToken: 'quiz-token' }] }] } as DayPageData
    quizScene.tests = { 'quiz-token': { testId: 'test', title: 'Лексикология', subject: 'Русский язык', status: 'submitted', answers: { written: 'Моя мысль' }, questions: [{ id: 'written', kind: 'long', prompt: 'Объясни значение', points: 1 }] } as unknown as Assignment }
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    const draw = () => root.render(<WeekendMathSlot token="day" taskIds={['control']} parent={parent} dueDate="2026-11-16" title="Русский на выходные" preparationThrough="2026-11-15" selectedDate="2026-11-17" />)
    try {
      await act(async () => draw())
      expect(host.textContent).toContain('Лексикология')
      expect(host.textContent).not.toContain('Выполни на выходных')
      expect(host.textContent).not.toContain('Сделано · проверено')
      expect(host.querySelector('input[type=file]')).toBeNull()
      quizScene.scores = { 'quiz-token': { points: 1, maxPoints: 1 } }
      await act(async () => draw())
      expect(host.textContent).toBe('')
    } finally { act(() => root.unmount()); host.remove() }
  })
  it.each([false, true])('retains unfinished optional work after Tuesday without a new photo requirement, parent=%s', async (parent) => {
    scene.role = parent ? 'parent' : 'student'
    const { host, close } = await renderSlot(parent, { preparationThrough: '2026-10-13', selectedDate: '2026-10-20' })
    try { expect(host.textContent).toContain('Подготовка к 13 октября'); expect(host.textContent).not.toContain('Сделано · проверено') } finally { close() }
  })
  it('removes only confirmed completed work from the active projection after Tuesday', async () => {
    for (let n = 1; n <= 8; n++) {
      scene.uploads.push({ id: `student-token:photo${n}`, taskId: `p${n}`, status: 'reviewed' } as DayUpload)
      scene.reviews.push({ taskId: `p${n}`, status: 'verified', uploadIds: [`photo${n}`] } as DayWorkReview)
    }
    const { host, close } = await renderSlot(true, { preparationThrough: '2026-10-13', selectedDate: '2026-10-20' })
    try { expect(host.textContent).toBe('') } finally { close() }
  })
  it.each([false, true])('opens, switches and closes own reviewed photos without losing linked thumbnails, parent=%s', async (parent) => {
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
      expect(host.querySelectorAll('[data-problem="p2"] .day-upload-chip')).toHaveLength(2)
      expect(host.querySelector('[data-problem="p2"] .weekend-math-photos')).not.toBeNull()
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
      expect(host.querySelector('[data-problem="p2"] .weekend-math-photos')).not.toBeNull()
      expect(host.querySelectorAll('[data-problem="p2"] .day-upload-chip')).toHaveLength(1)
      expect(host.querySelector('[data-problem="p2"] .weekend-math-photo-delete')).toBeNull()
      expect(host.querySelector('[data-problem="p2"] .day-review-progress')?.textContent).toContain('ждёт проверки')
    } finally { close() }
  })
  it.each([true, false])('keeps all eight numbers visible and optional for parent=%s', async (parent) => {
    scene.role = parent ? 'parent' : 'student'
    const { host, close } = await renderSlot(parent)
    try {
      const toggle = host.querySelector<HTMLButtonElement>('.problem-group-toggle')!
      expect(toggle.textContent).toContain('0 из 8')
      expect(toggle.textContent).not.toMatch(/по желанию|обязательно|опционально/iu)
      expect(toggle.getAttribute('aria-label')).toContain('0 из 8 проверено')
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
      expect(host.querySelector('.problem-group-toggle')?.textContent).toContain('0 из 8')
      expect(host.querySelector('.problem-group-toggle')?.getAttribute('aria-label')).toContain('обязательная часть 0 из 1')
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
