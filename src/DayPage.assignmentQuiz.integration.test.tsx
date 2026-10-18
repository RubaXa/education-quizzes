// @vitest-environment jsdom
// @see ../docs/modules/school-diary/day-page.md#numbered-sheet-and-quiz
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
  guides: {} as Record<string, unknown>,
  choiceCalls: [] as boolean[],
  quizOptional: false,
  quizChoiceCalls: [] as boolean[],
}))

vi.mock('./lib/dayStore', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/dayStore')>(),
  watchDayPage: (_token: string, onChange: (page: DayPageData) => void) => {
    if (scene.page) onChange({ ...scene.page, kind: scene.role })
    return () => {}
  },
  watchDayHelp: (_tokens: string[], onChange: (items: unknown[]) => void) => { onChange([]); return () => {} },
  watchDayTaskGuides: (_token: string, onChange: (guides: Record<string, unknown>) => void) => { onChange(scene.guides); return () => {} },
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
      description: 'Самопроверка по теме.', questions: Array.from({ length: 20 }, (_, index) => ({ id: `q-${index}` })), answers: {}, familyOptional: scene.quizOptional,
      createdAt: { seconds: 1792000000, nanoseconds: 0 }, updatedAt: { seconds: 1792003600, nanoseconds: 0 } } },
    scores: {}, ready: true,
  }),
}))
vi.mock('./lib/store', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/store')>(),
  setQuizRequired: async (_root: string, _active: string, required: boolean) => {
    scene.quizChoiceCalls.push(required)
    scene.quizOptional = !required
  },
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
    original: { text: `№ ${index + 1}. Постройте диаграмму.`, attachmentRef: 'teacher-sheet',
      crop: { x: 20, y: 30, width: 420, height: 180, sourceWidth: 1000, sourceHeight: 700, sourceSha256: 'teacher-sha' } },
    support: { skill: 'Круговая диаграмма', state: 'unknown' as const, evidence: 'Сверенный лист', evidenceRefs: ['teacher-sheet'],
      facts: [{ label: 'Птицы', value: '20' }, { label: 'Животные', value: '10' }, { label: 'Автомобили', value: '60' }],
      find: 'Доли на диаграмме', firstQuestion: 'Какие величины даны?', revision: 1 },
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
    materialLinks: { [taskId]: [{ title: 'Лист учителя', sourceType: 'teacher-attachment', url: 'https://disk.yandex.ru/d/example', sourceRef: 'teacher-sheet', sourceSha256: 'teacher-sha' }] },
  }
}

beforeEach(() => {
  scene.page = page()
  scene.role = 'parent'
  scene.reviews = firstProblemIds.map((id) => ({ id: `review-${id}`, taskId: id, status: 'verified', uploadIds: ['photo-1'] }))
  scene.uploads = [{ id: 'student-token:photo-1', taskId: firstProblemIds[0], coveredTaskIds: firstProblemIds, status: 'reviewed' }]
  scene.decisions = [{ id: 'optional', taskId, variantId: second, action: 'variant-optional', reviewCheckedAt: null,
    decidedAt: { seconds: 100, nanoseconds: 0 } }]
  scene.guides = { [firstProblemIds[0]]: { guide: { kind: 'worked-solution', presentation: 'math-route', overview: 'Разбор для родителя', stages: [] } } }
  scene.choiceCalls = []
  scene.quizOptional = false
  scene.quizChoiceCalls = []
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

it.each([false, true])('keeps the file at its upload origin and shows only references elsewhere, parent=%s', async (parent) => {
  const view = await renderPage(parent)
  try {
    await act(async () => view.host.querySelector<HTMLButtonElement>('.problem-group-toggle')!.click())
    const origin = view.host.querySelector<HTMLElement>(`#${firstProblemIds[0]}`)!
    expect(origin.querySelectorAll('.day-upload-chip')).toHaveLength(1)
    await act(async () => origin.querySelector<HTMLButtonElement>('.day-upload-chip')!.click())
    expect(origin.querySelector('.day-upload-expanded')).not.toBeNull()
    await act(async () => origin.querySelector<HTMLButtonElement>('[aria-label="Закрыть фото"]')!.click())
    expect(origin.querySelector('.day-upload-expanded')).toBeNull()
    for (const id of firstProblemIds.slice(1)) {
      const other = view.host.querySelector<HTMLElement>(`#${id}`)!
      expect(other.querySelector('.day-upload-list')).toBeNull()
      expect(other.querySelector('.linked-work-photos')?.textContent).toContain('Марки Ивана')
      expect(other.querySelector('.linked-work-photos .education-image')).toBeNull()
      expect(other.querySelector('.linked-work-photos .day-upload-delete')).toBeNull()
    }
    expect(view.host.querySelector('.problem-group-toggle')?.getAttribute('aria-label')).toContain('5 из 5')
  } finally { await view.cleanup() }
})

it.each([false, true])('keeps ordinary task galleries separate when one photo proves another task, parent=%s', async (parent) => {
  scene.page!.subjects[0].tasks = ['origin', 'other'].map((id) => ({ id, kind: 'written', status: 'unknown', title: id === 'origin' ? 'Запись в тетради' : 'Другая работа', detail: '', source: 'МЭШ' }))
  scene.page!.testPlacements = []
  scene.uploads = [{ id: 'student-token:shared-photo', taskId: 'origin', coveredTaskIds: ['other'], status: 'reviewed' }]
  scene.reviews = [{ id: 'review-other', taskId: 'other', status: 'verified', uploadIds: ['shared-photo'] }]
  const view = await renderPage(parent)
  try {
    const origin = view.host.querySelector('#day-task-origin')!
    const other = view.host.querySelector('#day-task-other')!
    expect(origin.querySelectorAll('.day-upload-chip')).toHaveLength(1)
    expect(other.querySelector('.day-upload-list')).toBeNull()
    expect(other.querySelector('.linked-work-photos')?.textContent).toContain('Запись в тетради')
    expect(other.textContent).toContain('Готово')
  } finally { await view.cleanup() }
})

/** @see ../docs/modules/materials/material-clarification.md */
it('asks the child for missing source material through the standard uploader, without grading it', async () => {
  scene.page!.subjects = [{id:'literature',name:'Литература',icon:'📖',materials:'',mesh:'Повторить записи по последней теме.',summary:'',tasks:[{
    id:'notes',kind:'read',status:'unknown',title:'Повторить записи',detail:'',source:'МЭШ',meshText:'Повторить записи по последней теме.',
    assessmentIntent:{state:'needs-topic',evidenceRef:'МЭШ не назвал тему'},
    materialRequest:{id:'notes-1',state:'open',question:'Какая последняя тема записана в тетради?',photoPrompt:'Пришли заголовок и все страницы последних записей.'},
  }]}]
  for (const parent of [false,true]) {
    sessionStorage.setItem('education-day-initial-tab', 'homework')
    const view = await renderPage(parent)
    try {
      expect(view.host.textContent).toContain('Какая последняя тема записана в тетради?')
      expect(view.host.textContent).toContain('Повторить записи по последней теме.')
      const input = view.host.querySelector<HTMLInputElement>('.day-upload input[type="file"]')
      expect(Boolean(input)).toBe(!parent)
      if (input) { expect(input.multiple).toBe(true); expect(input.accept).toBe('image/*') }
      expect(view.host.textContent).toContain('Нужен материал для уточнения')
      expect(view.host.textContent).not.toContain('Работа проверена')
    } finally { await view.cleanup() }
  }
})

/** @see ../docs/modules/materials/material-clarification.md */
it('preserves resolved source photos and observations beside the linked quiz for both roles', async () => {
  scene.page!.subjects[0].tasks = [{id:'notes',kind:'read',status:'unknown',title:'Повторить записи',detail:'',source:'МЭШ',meshText:'Повторить записи по последней теме.',testToken:'diagrams-test',
    assessmentIntent:{state:'confirmed',mode:'ordinary',topic:'Сказание',evidenceRef:'Два снимка записей'},
    materialRequest:{id:'notes-1',state:'resolved',question:'Какая последняя тема записана?',photoPrompt:'Пришли фото записей.',resolvedTopic:'Сказание о белгородском киселе',uploadIds:['notes-photo']}}]
  scene.page!.testPlacements = [{token:'diagrams-test',subjectId:'math',taskId:'notes'}]
  scene.uploads = [{id:'student-token:notes-photo',taskId:'notes',status:'reviewed'}]
  scene.reviews = [{id:'notes-review',taskId:'notes',purpose:'source-material',uploadIds:['notes-photo'],sourceAnalysis:{requestId:'notes-1',topic:'Сказание о белгородском киселе',observed:'Видны план старца и главная мысль.',quality:'Записи читаемы.',limitation:'Повторение по памяти неизвестно.',nextStep:'Пройди самопроверку.',evidence:[{uploadId:'notes-photo',location:'Заголовок страницы',text:'Сказание о белгородском киселе'}]}}]
  for (const parent of [false,true]) {
    sessionStorage.setItem('education-day-initial-tab','homework')
    const view=await renderPage(parent)
    try {
      const quiz=view.host.querySelector('.day-quiz-lineage')!
      expect(quiz).not.toBeNull()
      expect(quiz.textContent).toContain('Сказание о белгородском киселе')
      expect(quiz.textContent).toContain('Видны план старца и главная мысль.')
      const photo=quiz.querySelector<HTMLButtonElement>('[aria-label="Открыть фото 1: Проверено"]')!
      expect(photo).not.toBeNull()
      await act(async()=>photo.click())
      expect(quiz.textContent).toContain('Фото не является результатом теста.')
      expect(quiz.textContent).not.toContain('Разбор этого задания показан в блоке «Проверка работы».')
      expect(quiz.textContent).not.toContain('Какая последняя тема записана?')
      expect(quiz.textContent).not.toContain('Пришли фото записей.')
      expect(quiz.querySelector('input[type="file"]')).toBeNull()
    } finally { await view.cleanup() }
  }
})

describe('day page: teacher sheet and linked self-check', () => {
  it('shows teacher-selected source tasks as optional for both roles and preserves the originals', async()=>{
    const task=scene.page!.subjects[0].tasks[0]
    task.practiceVariants=task.practiceVariants!.map(variant=>({...variant,optionalByTeacher:{sourceRef:'teacher-sheet',excerpt:'Реши сколько получится.'}}))
    scene.decisions=[]
    for (const parent of [false,true]) {
      sessionStorage.setItem('education-day-initial-tab','homework')
      const view=await renderPage(parent)
      try {
        await act(async()=>view.host.querySelector<HTMLButtonElement>('.problem-group-toggle')?.click())
        const variants=Array.from(view.host.querySelectorAll('.day-practice-variant-shell'))
        expect(variants).toHaveLength(2)
        for(const variant of variants) {
          expect(variant.textContent).toContain('По желанию')
          if(parent) expect(variant.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
          else expect(variant.querySelector('[role="switch"]')).toBeNull()
        }
        expect(view.host.querySelector('.day-problem-list')).not.toBeNull()
      } finally {await view.cleanup()}
    }
  })
  it('does not count reviewed written work or a verified platform result as remaining work', async()=>{
    scene.page!.subjects[0].tasks=[
      {id:'written',kind:'written',status:'unknown',title:'Запись',detail:'',source:'МЭШ'},
      {id:'platform',kind:'check',status:'unknown',title:'Выполнить ЦДЗ',detail:'',source:'МЭШ'},
    ]
    scene.page!.testPlacements=[]
    scene.reviews=[{id:'written-review',taskId:'written',status:'verified',uploadIds:['a']},{id:'platform-review',taskId:'platform',status:'verified',uploadIds:['b']}]
    scene.uploads=[]
    const view=await renderPage(true)
    try { expect(view.host.querySelector('.day-summary strong')?.textContent).toBe('0') }
    finally {await view.cleanup()}
  })
  /** @see ../docs/modules/school-diary/dashboard.md#compact-homework */
  it('uses one dated homework heading without the repeated lesson explanation', async()=>{
    for (const parent of [false,true]) {
      sessionStorage.setItem('education-day-initial-tab','homework')
      const view=await renderPage(parent)
      try {
        expect(view.host.querySelector('h1')?.textContent).toBe('Домашнее задание')
        expect(view.host.querySelector('.day-hero>p')?.textContent).toBe('Среда, 14 октября')
        expect(view.host.textContent).not.toContain('к урокам')
        expect(view.host.textContent).not.toContain('только назначения этих уроков')
        expect(view.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Задания')
        await act(async()=>view.host.querySelector<HTMLButtonElement>('[role="tab"]')!.click())
        expect(view.host.querySelector('h1')?.textContent).toBe('Расписание')
      } finally { await view.cleanup() }
    }
  })
  it('shows stored attempt times through only the shared quiz icon', async () => {
    const view = await renderPage(true)
    try {
      const quiz = view.host.querySelector('.day-quiz-lineage')
      const trigger = quiz?.querySelector<HTMLButtonElement>('.day-quiz-time-trigger')
      expect(trigger?.getAttribute('aria-expanded')).toBe('false')
      expect(quiz?.querySelector('.day-quiz-time-details')).toBeNull()
      await act(async () => { trigger?.click() })
      expect(trigger?.getAttribute('aria-expanded')).toBe('true')
      expect(quiz?.querySelector('.day-quiz-time-details')?.textContent).toContain('Создан')
      expect(quiz?.querySelector('.day-quiz-time-details time')).not.toBeNull()
      expect(quiz?.querySelector('.day-quiz-time-details')?.textContent).toContain('Не начат')
      expect(quiz?.querySelector('.day-quiz-time-details')?.textContent).toContain('Не завершён')
    } finally { await view.cleanup() }
  })
  it('excludes only the active quiz, then restores it without losing the teacher sheet', async () => {
    const view = await renderPage(true)
    try {
      const control = () => view.host.querySelector<HTMLButtonElement>('.day-quiz-requirement [role="switch"]')
      expect(control()?.getAttribute('aria-checked')).toBe('true')
      expect(view.host.querySelector('.day-quiz-requirement')?.textContent).toBe('')
      expect(view.host.querySelector('.day-subject-assignment-count')?.textContent).toContain('Задачи: 5 из 5')
      await act(async () => { control()?.click() })
      await act(async () => { view.root.render(<DayPage token="student-token" parent headerReturnTarget={null} />) })
      expect(scene.quizChoiceCalls).toEqual([false])
      expect(control()?.getAttribute('aria-checked')).toBe('false')
      expect(view.host.querySelector('.day-quiz-requirement')?.textContent).toBe('')
      expect(view.host.querySelector('.day-subject-assignment-count')?.textContent).toContain('Задачи: 5 из 5')
      expect(view.host.querySelector('.problem-group')).not.toBeNull()
      await act(async () => { control()?.click() })
      await act(async () => { view.root.render(<DayPage token="student-token" parent headerReturnTarget={null} />) })
      expect(scene.quizChoiceCalls).toEqual([false, true])
      expect(control()?.getAttribute('aria-checked')).toBe('true')
    } finally { await view.cleanup() }
  })
  it('does not count an optional test as remaining, but keeps an unfinished teacher number', async () => {
    scene.quizOptional = true
    const view = await renderPage(true)
    try {
      expect(view.host.querySelector('.day-summary strong')?.textContent).toBe('0')
      expect(view.host.querySelector('.day-summary')?.textContent).not.toContain('обязательных тестов')
      scene.reviews = scene.reviews.filter((review) => review.taskId !== firstProblemIds[0])
      await act(async () => { view.root.render(<DayPage token="student-token" parent headerReturnTarget={null} />) })
      expect(view.host.querySelector('.day-summary strong')?.textContent).toBe('1')
      expect(view.host.querySelector('.day-subject-assignment-count')?.textContent).toContain('Задачи: 4 из 5')
    } finally { await view.cleanup() }
  })
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

  it.each([true, false])('keeps original, exact text and given/find in the opened problem (parent=%s)', async (parent) => {
    const view = await renderPage(parent)
    try {
      await act(async () => { view.host.querySelector<HTMLButtonElement>('.problem-group-toggle')?.click() })
      await act(async () => { view.host.querySelector<HTMLElement>('.day-practice-variant > summary')?.click() })
      await act(async () => { view.host.querySelector<HTMLElement>('.day-practice-variant .problem-card-heading')?.click() })
      const number = view.host.querySelector('.day-practice-variant .problem-card')
      expect(number?.querySelector('.source-fragment-trigger')).not.toBeNull()
      expect(number?.querySelector('.problem-statement-transcript')?.textContent).toContain('№ 1. Постройте диаграмму.')
      expect(number?.querySelector('.problem-statement-facts')?.textContent).toContain('Птицы')
      expect(number?.querySelector('.problem-statement-find')?.textContent).toContain('Доли на диаграмме')
      if (parent) {
        expect(number?.querySelector('.day-parent-guide')).not.toBeNull()
        expect(number?.querySelector('.problem-card-upload')).toBeNull()
      } else {
        expect(number?.querySelector('.day-parent-guide')).toBeNull()
        expect(number?.querySelector('.problem-card-upload')).not.toBeNull()
      }
    } finally { await view.cleanup() }
  })

  it('keeps a numbered teacher sheet when no self-check was assigned', async () => {
    const current = page()
    current.testPlacements = []
    delete current.subjects[0].tasks[0].testToken
    scene.page = current
    const view = await renderPage(true)
    try {
      expect(view.host.querySelectorAll('.day-quiz-lineage')).toHaveLength(0)
      expect(view.host.querySelectorAll('.problem-group')).toHaveLength(1)
      await act(async () => { view.host.querySelector<HTMLButtonElement>('.problem-group-toggle')?.click() })
      expect(view.host.querySelectorAll('.day-practice-variant')).toHaveLength(2)
    } finally { await view.cleanup() }
  })

  it('keeps a second independent teacher assignment apart from the linked quiz', async () => {
    const current = page()
    const another = structuredClone(current.subjects[0].tasks[0])
    another.id = 'mesh-geometry'
    another.title = 'Решить задачу по геометрии'
    delete another.testToken
    delete another.practiceVariants
    another.problems = [{ id: 'geometry-p1', number: 1, title: 'Отрезки', detail: '', source: 'Другой лист учителя',
      original: { text: '№ 1. Найдите длину отрезка.', attachmentRef: 'geometry-sheet' } }]
    current.subjects[0].tasks.push(another)
    current.materialLinks!['mesh-geometry'] = [{ title: 'Другой лист учителя', sourceType: 'teacher-attachment',
      url: 'https://disk.yandex.ru/d/geometry', sourceRef: 'geometry-sheet' }]
    scene.page = current
    const view = await renderPage(true)
    try {
      expect(view.host.querySelectorAll('.day-quiz-lineage')).toHaveLength(1)
      expect(view.host.querySelectorAll('.problem-group')).toHaveLength(2)
      expect(view.host.querySelectorAll('.problem-group')[0].textContent).toContain('Подготовиться к самостоятельной: диаграммы')
      expect(view.host.querySelectorAll('.problem-group')[1].textContent).toContain('Решить задачу по геометрии')
      expect(view.host.querySelectorAll('.problem-group')[1].textContent).not.toContain('Марки Ивана')
    } finally { await view.cleanup() }
  })
})
