// @vitest-environment jsdom
// @see ../docs/modules/school-diary/day-page.md#numbered-sheet-and-quiz
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DayPageData, DayTask, DayUpload, DayWorkReview } from './lib/dayStore'
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
  quizSubmitted: false,
  quizSubject: 'Математика',
  quizSlug: 'diagrams',
  quizChoiceCalls: [] as boolean[],
  guidanceCalls: [] as unknown[][],
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
  sendDayGuidance: async (...args: unknown[]) => { scene.guidanceCalls.push(args) },
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
    boardEntries: [{ token: 'diagrams-test', testId: 'quiz-1', title: 'Диаграммы — тренировка', subject: scene.quizSubject, slug: scene.quizSlug, previewToken: 'preview-only' }],
    tests: { 'diagrams-test': { testId: 'quiz-1', status: scene.quizSubmitted ? 'submitted' : 'open', title: 'Диаграммы — тренировка', subject: scene.quizSubject,
      description: 'Самопроверка по теме.', questions: Array.from({ length: scene.quizSubmitted ? 8 : 20 }, (_, index) => ({ id: `q-${index}` })), answers: {}, familyOptional: scene.quizOptional,
      createdAt: { seconds: 1792000000, nanoseconds: 0 }, updatedAt: { seconds: 1792003600, nanoseconds: 0 } } },
    scores: scene.quizSubmitted ? { 'diagrams-test': { points: 8, maxPoints: 8 } } : {}, ready: true,
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
  scene.quizSubmitted = false
  scene.quizSubject = 'Математика'
  scene.quizSlug = 'diagrams'
  scene.quizChoiceCalls = []
  scene.guidanceCalls = []
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

it.each([true, false])('keeps an olympiad placement outside required work in role parent=%s', async (parent) => {
  scene.page = { ...page(), subjects: [{ id: 'math', name: 'Математика', icon: '∑', materials: '', mesh: '', summary: '', tasks: [] }],
    testPlacements: [{ token: 'diagrams-test', subjectId: 'math', optional: true }] }
  scene.quizOptional = false
  const view = await renderPage(parent)
  try {
    expect(view.host.querySelector('.day-summary strong')?.textContent).toBe('0')
    expect(view.host.textContent).not.toContain('обязательных тестов завершено')
    expect(view.host.querySelector('[aria-label^="Учитывать тест"]')).toBeNull()
    expect(view.host.textContent).toContain('Диаграммы — тренировка')
  } finally { await view.cleanup() }
})

it.each([true, false])('projects only the selected family olympiad task and its additional test for parent=%s', async (parent) => {
  const id = 'family-olympiad'
  const extra = { id, title: 'Олимпиадная практика', detail: 'Своя задача', source: 'Education', kind: 'written' as const, status: 'unknown' as const,
    optional: true, learningContext: { kind: 'olympiad' as const, id: 'o1' } }
  scene.page = { ...page(), familyId: 'family', childId: 'child', parentNotes: ['Снимок МЭШ на дату'], changes: [{ at: null, added: [id], changed: [], removed: [], newLinks: false }], sourceOnlyEntries: [{ id: 'notice', kind: 'notice', rawText: 'МЭШ · не задано' }] as DayPageData['sourceOnlyEntries'], subjects: [{ ...page().subjects[0], tasks: [...page().subjects[0].tasks, extra] }],
    testPlacements: [{ token: 'diagrams-test', subjectId: 'math', optional: true }] }
  scene.role = parent ? 'parent' : 'student'
  sessionStorage.setItem('education-day-initial-tab', 'school')
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<DayPage token="role-day" parent={parent} headerReturnTarget={null} olympiadScope={{ familyId: 'family', childId: 'child', olympiadId: 'o1', taskId: id, testTokens: ['diagrams-test'] }} />))
    expect(host.textContent).toContain('Олимпиадная практика')
    expect(host.textContent).not.toContain('Подготовиться к самостоятельной: диаграммы')
    expect(host.querySelector('.problem-card')?.hasAttribute('open')).toBe(false)
    expect(host.textContent).toContain('Диаграммы — тренировка')
    expect(host.querySelector('.day-quiz-lineage-score')?.textContent).toContain('0 из 20')
    expect(host.querySelector('[aria-label="Раздел страницы дня"]')).toBeNull()
    expect(host.textContent).not.toContain('Расписание')
    expect(host.textContent).not.toContain('МЭШ')
    expect(host.textContent).not.toContain('Что изменилось')
    expect(host.textContent).not.toContain('О задании')
    const quiz = host.querySelector<HTMLAnchorElement>('.day-quiz-lineage-actions a.day-quiz-link')
    expect(quiz?.getAttribute('href')).toBe(parent ? '#/preview/diagrams~preview-only' : '#/t/diagrams~diagrams-test')
    expect(host.querySelector('input[type=file]') !== null).toBe(!parent)
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('keeps the ordinary parent day wired to the same prepared guidance command', async () => {
  const guide = { kind: 'worked-solution', presentation: 'math-route', revision: 1, overview: 'Разбор', stages: [{
    id: 'data', title: 'Данные', role: 'given', expected: 'Полный ход', rows: [], hintPreview: 'Какие величины даны?', revealPreview: 'Доли на диаграмме.',
    source: { kind: 'teacher-file', label: 'Учитель', ref: 'sheet', excerpt: 'Диаграмма' },
  }] }
  scene.guides = { [firstProblemIds[0]]: { guide } }
  const view = await renderPage(true)
  try {
    await act(async () => view.host.querySelector<HTMLButtonElement>('.problem-group-toggle')!.click())
    const card = view.host.querySelector<HTMLElement>(`#${firstProblemIds[0]}`)!
    await act(async () => card.querySelector<HTMLButtonElement>('[aria-label^="Выбрать подсказку"]')!.click())
    const send = card.querySelector<HTMLButtonElement>('.day-learning-route-preview button')!
    expect(send.disabled).toBe(false)
    await act(async () => send.click())
    expect(scene.guidanceCalls).toEqual([['student-token', firstProblemIds[0], guide, 'data', 'hint']])
    expect(card.textContent).toContain('Подсказка отправлена')
    expect(card.querySelector('[aria-label^="Выбрать показ полного шага"]')).not.toBeNull()
  } finally { await view.cleanup() }
})

it.each([false, true])('shows family task provenance without MESH wording, parent=%s', async (parent) => {
  scene.page!.subjects = [{ id: 'russian', name: 'Русский язык', icon: '✍', materials: '', mesh: '', summary: '', tasks: [{
    id: 'family-russian-essay', kind: 'written', status: 'unknown', title: 'Подготовка к сочинению',
    detail: 'Это подготовка по просьбе родителя; точная школьная тема пока неизвестна.', source: 'Education · назначено родителем',
    familyOrigin: { sourceSystem: 'family', sourceId: 'family-russian-essay', sourceRevision: 1 },
    steps: ['Наблюдай за видом из окна', 'Составь собственный план'],
    submission: { buttonLabel: 'Прикрепить работу', lead: 'Напиши свой черновик.', photo: 'Сфотографируй все страницы.' },
  }] }]
  scene.page!.testPlacements = []
  scene.page!.materialLinks = {}
  const view = await renderPage(parent)
  try {
    const task = view.host.querySelector<HTMLElement>('#day-task-family-russian-essay')!
    expect(task.textContent).toContain('Подготовка Education')
    expect(task.textContent).toContain('По просьбе родителя')
    expect(task.textContent).not.toContain('Задание учителя')
    expect(task.textContent).not.toContain('Как записано в МЭШ')
    const source = task.querySelector<HTMLElement>('.day-instruction-source summary')!
    expect(source.getAttribute('aria-label')).toContain('семейной подготовки по просьбе родителя')
    await act(async () => source.click())
    expect(task.textContent).toContain('Этот шаг относится к семейной практике и не является требованием учителя.')
  } finally { await view.cleanup() }
})

it.each([false, true])('shows an exact non-action MESH notice without an empty card or debt, parent=%s', async (parent) => {
  scene.page!.subjects = [{ id: 'math', name: 'Математика', icon: '∑', materials: '', mesh: 'Всем хороших каникул!', summary: '', tasks: [] }]
  scene.page!.testPlacements = []
  scene.page!.sourceOnlyEntries = [{ kind: 'notice', id: 'mesh-352682606', subjectId: 'math', rawText: 'Всем хороших каникул!',
    reason: 'Точная отдельная поздравительная запись МЭШ; в ней нет учебного действия.' }]
  const view = await renderPage(parent)
  try {
    expect(view.host.textContent).toContain('Всем хороших каникул!')
    expect(view.host.textContent).toContain('МЭШ · Математика')
    expect(view.host.querySelector('.day-summary strong')?.textContent).toBe('0')
    expect(view.host.querySelectorAll('.day-task')).toHaveLength(0)
    expect(view.host.textContent).not.toContain('На эту дату задания в МЭШ пока не указаны.')
  } finally { await view.cleanup() }
})

it.each([false, true])('keeps the file at its upload origin and shows the same thumbnails elsewhere, parent=%s', async (parent) => {
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
      expect(other.querySelector('.day-upload-list')).not.toBeNull()
      expect(other.querySelectorAll('.day-upload-chip')).toHaveLength(1)
      expect(other.querySelector('.day-upload-strip .education-image')).not.toBeNull()
      expect(other.querySelector('.day-upload-delete')).toBeNull()
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
    expect(other.querySelector('.day-upload-list')).not.toBeNull()
    expect(other.querySelectorAll('.day-upload-chip')).toHaveLength(1)
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
      if (input) { expect(input.multiple).toBe(true); expect(input.accept).toContain('image/*'); expect(input.accept).toContain('.pdf'); expect(input.accept).toContain('.docx'); expect(input.accept).toContain('.xlsx'); expect(input.accept).toContain('.txt') }
      expect(view.host.textContent).toContain('Нужен материал для уточнения')
      expect(view.host.textContent).not.toContain('Работа проверена')
    } finally { await view.cleanup() }
  }
})

/** @see ../docs/modules/school-diary/day-page.md#upload-queue */
it('lets a pupil submit a written result even when Mesh classifies the task as reading', async () => {
  scene.page!.subjects = [{ id: 'russian', name: 'Русский язык', icon: 'А', materials: '',
    mesh: 'Найти 5 пословиц или поговорок с исконно русскими словами. Объяснить их смысл.', summary: '',
    tasks: [{ id: 'proverbs', kind: 'read', status: 'unknown', title: 'Пять пословиц или поговорок: слова и смысл',
      detail: '', source: 'МЭШ', meshText: 'Найти 5 пословиц или поговорок с исконно русскими словами. Объяснить их смысл.' }] }]
  scene.page!.testPlacements = []
  scene.page!.materialLinks = {}
  for (const parent of [false, true]) {
    sessionStorage.setItem('education-day-initial-tab', 'homework')
    const view = await renderPage(parent)
    try {
      const task = view.host.querySelector<HTMLElement>('#day-task-proverbs')!
      expect(task.textContent).toContain('Объяснить их смысл')
      const upload = task.querySelector<HTMLInputElement>('.day-upload input[type="file"]')
      expect(Boolean(upload)).toBe(!parent)
      if (upload) {
        expect(upload.multiple).toBe(true)
        expect(task.querySelector('.day-upload')?.textContent).toContain('Загрузить решение')
      }
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
      const photo=quiz.querySelector<HTMLButtonElement>('[aria-label^="Открыть Фото 1 · Проверено"]')!
      expect(photo).not.toBeNull()
      expect(photo.getAttribute('aria-label')).toContain('Время получения неизвестно')
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
          expect(variant.textContent).not.toContain('По желанию')
          if(parent) expect(variant.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
          else expect(variant.querySelector('[role="switch"]')).toBeNull()
        }
        expect(view.host.querySelector('.day-problem-list')).not.toBeNull()
      } finally {await view.cleanup()}
    }
  })
  it.each([false,true])('does not request another screenshot for verified platform work or count it as remaining, parent=%s', async(parent)=>{
    scene.page!.subjects[0].tasks=[
      {id:'written',kind:'written',status:'unknown',title:'Запись',detail:'',source:'МЭШ'},
      {id:'platform',kind:'check',status:'unknown',title:'Выполнить ЦДЗ',detail:'',source:'МЭШ'},
    ]
    scene.page!.testPlacements=[]
    scene.reviews=[{id:'written-review',taskId:'written',status:'verified',uploadIds:['a']},{id:'platform-review',taskId:'platform',status:'verified',uploadIds:['b']}]
    scene.uploads=[]
    const view=await renderPage(parent)
    try {
      expect(view.host.querySelector('.day-summary strong')?.textContent).toBe('0')
      const card=view.host.querySelector<HTMLDetailsElement>('#day-task-platform')!
      expect(card.open).toBe(false)
      expect(card.querySelector(':scope > summary .day-task-state')?.textContent).toBe('Готово · проверено')
      expect(card.querySelector(':scope > summary')?.textContent).not.toContain('Нужен скриншот')
    }
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
      expect(view.host.querySelector('.day-subject-assignment-count')?.textContent).toContain('5 из 10')
      await act(async () => { control()?.click() })
      await act(async () => { view.root.render(<DayPage token="student-token" parent headerReturnTarget={null} />) })
      expect(scene.quizChoiceCalls).toEqual([false])
      expect(control()?.getAttribute('aria-checked')).toBe('false')
      expect(view.host.querySelector('.day-quiz-requirement')?.textContent).toBe('')
      expect(view.host.querySelector('.day-subject-assignment-count')?.textContent).toContain('5 из 10')
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
      expect(view.host.querySelector('.day-subject-assignment-count')?.textContent).toContain('4 из 10')
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
      expect(view.host.querySelector('.day-quiz-lineage input[type="file"]')).toBeNull()
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
      expect(view.host.querySelectorAll('#day-task-mesh-diagrams')).toHaveLength(1)
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
      expect(view.host.querySelector('.day-subject-assignment-count')?.textContent).toContain('5 из 10')
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
      expect(view.host.querySelector('.day-subject-assignment-count')?.textContent).toContain('5 из 10')
      const enabledSwitch = view.host.querySelectorAll<HTMLButtonElement>('.day-practice-variant-shell [role="switch"]')[1]
      expect(enabledSwitch.getAttribute('aria-checked')).toBe('true')
      await act(async () => { enabledSwitch.click() })
      await act(async () => { view.root.render(<DayPage token="student-token" parent headerReturnTarget={null} />) })
      expect(scene.choiceCalls).toEqual([true, false])
      expect(view.host.querySelector('.day-subject-assignment-count')?.textContent).toContain('5 из 10')
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
      expect(view.host.querySelectorAll('.day-practice-variant-shell')[1]?.textContent).not.toContain('По желанию')
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

  it.each([true, false])('renders public support in a mixed-source card for parent=%s without clearing its blocker', async (parent) => {
    const current = page()
    current.testPlacements = []
    current.subjects[0].tasks = [{ id: 'mesh-english', title: 'Упр.5, WB15–16', detail: 'упр.5 стр.31, р.т.15–16', meshText: 'упр.5 стр.31, р.т.15–16',
      source: 'МЭШ', kind: 'check', status: 'unknown', sourceOnly: true,
      instructionStatus: { state: 'needs-review', message: 'WB original missing' },
      materialStatus: { state: 'textbook-page-needed', message: 'WB15–16 не сверена' },
      learnerFlow: { version: 1, scope: 'Только упр.5', meshExcerpt: 'упр.5 стр.31', goal: 'Свой диалог', boundary: 'WB15–16 ждёт оригинала',
        source: { pageId: 'book:31', label: 'SB31', excerpt: 'Use the plan' }, stages: ['plan', 'check'].map(id => ({ id, title: id, prompt: 'Подумай о собеседнике', hint: 'Посмотри схему', frame: 'Сверь пару реплик', sourceLabel: 'SB31 ex5' })) } }]
    scene.page = current
    const view = await renderPage(parent)
    try {
      expect(view.host.querySelectorAll('.day-learner-flow')).toHaveLength(1)
      expect(view.host.textContent).toContain('WB15–16 ждёт оригинала')
      expect(view.host.querySelector('.day-task-state')?.textContent).toContain('Статус неизвестен')
      expect(view.host.querySelector('.day-parent-guide')).toBeNull()
      const next = [...view.host.querySelectorAll<HTMLButtonElement>('.day-learner-flow button')].find(b => b.textContent === 'Следующий шаг')!
      await act(async () => next.click())
      expect(view.host.querySelector('.day-learner-flow-stage')?.textContent).toContain('Шаг 2')
      expect(view.host.querySelector('.day-task-state')?.textContent).toContain('Статус неизвестен')
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

/** @see ../docs/modules/materials/audio-library.md#assignment */
it.each([false, true])('keeps an audio-only listening task inside both day and quiz cards, parent=%s', async (parent) => {
 for (const linkedQuiz of [false, true]) {
  scene.page = page()
  sessionStorage.setItem('education-day-initial-tab', 'homework')
  const task = scene.page.subjects[0].tasks[0]
  task.problems = undefined; task.practiceVariants = undefined; task.steps = []
  task.kind = linkedQuiz ? 'check' : 'written'
  task.testToken = linkedQuiz ? 'diagrams-test' : undefined
  scene.page.testPlacements = linkedQuiz ? scene.page.testPlacements : []
  scene.page.materialLinks = { [taskId]: [{ sourceType: 'audio', title: 'Starlight 6 · с. 31, упр. 2a', url: 'https://disk.yandex.ru/d/audio', sourceRef: 'audio:starlight-6-2-09' }] }
  const view = await renderPage(parent)
  try {
   expect(view.host.querySelector('.edu-audio'), `linkedQuiz=${linkedQuiz}, ${view.host.textContent}`).not.toBeNull()
   expect(view.host.querySelector('.edu-audio button')?.getAttribute('aria-label')).toContain('Воспроизвести')
   expect(view.host.querySelector('audio')?.controls).toBe(false)
   expect(view.host.querySelector('.edu-audio-speed')).not.toBeNull()
   expect(view.host.querySelector('audio')?.getAttribute('src')).toBeNull()
   expect(view.host.querySelectorAll('a[href="https://disk.yandex.ru/d/audio"]')).toHaveLength(1)
  } finally { await view.cleanup() }
 }
})

it.each([true, false])('keeps olympiad groups closed on entry and reveals their unchanged tasks on request, parent=%s', async parent => {
  const source = page()
  const original = source.subjects[0].tasks[0]
  scene.page = { ...source, familyId: 'family', childId: 'child', subjects: [{ ...source.subjects[0], tasks: [{ ...original, optional: true, learningContext: { kind: 'olympiad', id: 'o1' } }] }], testPlacements: [] }
  scene.role = parent ? 'parent' : 'student'
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<DayPage token="role-day" parent={parent} headerReturnTarget={null} olympiadScope={{ familyId: 'family', childId: 'child', olympiadId: 'o1', taskId, testTokens: [] }} />))
    expect(host.querySelector('.problem-group-toggle')?.getAttribute('aria-expanded')).toBe('false')
    await act(async()=>host.querySelector<HTMLButtonElement>('.problem-group-toggle')!.click())
    expect(host.querySelectorAll('.day-practice-variant[open]')).toHaveLength(0)
    await act(async()=>host.querySelector<HTMLElement>('.day-practice-variant > summary')!.click())
    expect(host.querySelectorAll('.day-problem-list [id]') .length).toBeGreaterThan(1)
    expect(host.textContent).toContain('Марки Ивана')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it.each([true, false])('shows the olympiad source sheet upload only to the learner, parent=%s', async parent => {
  const id = 'source-sheet'
  const sourceTask = { id, title: 'Свои задачи', detail: 'Пришли фото листа с условиями.', source: 'Education', kind: 'written' as const, status: 'unknown' as const,
    optional: true, learningContext: { kind: 'olympiad' as const, id: 'o1' }, sourceIntake: { kind: 'olympiad-sheet' as const } }
  scene.page = { ...page(), familyId: 'family', childId: 'child', subjects: [{ ...page().subjects[0], tasks: [sourceTask] }], testPlacements: [] }
  scene.role = parent ? 'parent' : 'student'
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<DayPage token="role-day" parent={parent} headerReturnTarget={null} olympiadScope={{ familyId: 'family', childId: 'child', olympiadId: 'o1', taskId: id, testTokens: [] }} />))
    expect(host.textContent).toContain('Очередь своих вариантов')
    expect(host.textContent).not.toContain('Загрузить решение')
    expect(host.querySelector('input[type=file]') !== null).toBe(!parent)
    if (!parent) expect(host.querySelector('.day-upload')?.textContent).toContain('Загрузить фотографии')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it.each([true, false])('shows learner-added source and the original photo alongside its own result, parent=%s', async parent => {
  const id = 'learner-task'
  const origin = { intakeTaskId: 'intake', uploadIds: ['photo-12345678901234567890'] }
  const newTask = { id, title: 'Задача из листа', detail: 'Подсчитай варианты', source: 'Education', kind: 'written' as const, status: 'unknown' as const,
    optional: true, learningContext: { kind: 'olympiad' as const, id: 'o1' }, learnerOrigin: origin }
  scene.page = { ...page(), familyId: 'family', childId: 'child', subjects: [{ ...page().subjects[0], tasks: [newTask] }], testPlacements: [] }
  scene.uploads = [{ id: 'student-token:photo-12345678901234567890', taskId: 'intake', status: 'pending' }]
  scene.role = parent ? 'parent' : 'student'
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<DayPage token="role-day" parent={parent} headerReturnTarget={null} olympiadScope={{ familyId: 'family', childId: 'child', olympiadId: 'o1', taskId: id, testTokens: [] }} />))
    expect(host.textContent).toContain('Добавлено учеником')
    expect(host.textContent).toContain('Фото условия')
    expect(host.textContent).toContain('Условие текстом')
    expect(host.textContent).toContain('Подсчитай варианты')
    expect(host.querySelector('.problem-statement-original')?.textContent).toContain('Фото условия')
    expect(host.querySelector('input[type=file]') !== null).toBe(!parent)
  } finally { await act(async () => root.unmount()); host.remove() }
})

it.each(['unknown', 'verified', 'needs-fix', 'partial'] as const)('keeps the existing photo uploader available for an olympiad task in state %s', async status => {
  const task = { id: 'practice-one', title: 'Задача', detail: 'Условие', source: 'Education', kind: 'written' as const, status,
    optional: true, learningContext: { kind: 'olympiad' as const, id: 'o1' } }
  scene.page = { ...page(), familyId: 'family', childId: 'child', subjects: [{ ...page().subjects[0], tasks: [task] }], testPlacements: [] }
  scene.role = 'student'
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<DayPage token="role-day" parent={false} headerReturnTarget={null} olympiadScope={{ familyId: 'family', childId: 'child', olympiadId: 'o1', taskId: task.id, testTokens: [] }} />))
    expect(host.querySelector('.problem-card')?.hasAttribute('open')).toBe(false)
    expect(host.querySelector('.problem-card-upload')?.textContent).toContain('Загрузить решение')
    expect(host.querySelector('.problem-card-upload input[type=file]')).not.toBeNull()
    expect(host.textContent).not.toContain('По просьбе родителя')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it.each([true, false])('shows incoming source photos as a queue without claiming a solution review for parent=%s', async parent => {
  const task = { id: 'source-sheet', title: 'Свои задачи', detail: 'Лист', source: 'Education', kind: 'written' as const, status: 'unknown' as const,
    optional: true, learningContext: { kind: 'olympiad' as const, id: 'o1' }, sourceIntake: { kind: 'olympiad-sheet' as const } }
  scene.page = { ...page(), familyId: 'family', childId: 'child', subjects: [{ ...page().subjects[0], tasks: [task] }], testPlacements: [] }
  scene.uploads = [{ id: 'student-token:source-photo', taskId: task.id, status: 'pending' }]
  scene.role = parent ? 'parent' : 'student'
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<DayPage token="role-day" parent={parent} headerReturnTarget={null} olympiadScope={{ familyId: 'family', childId: 'child', olympiadId: 'o1', taskId: task.id, testTokens: [] }} />))
    expect(host.textContent).toContain('Очередь своих вариантов')
    expect(host.textContent).toContain('обработка условий ожидается')
    expect(host.querySelectorAll('.day-upload-chip')).toHaveLength(1)
    expect(host.querySelector('input[type=file]') !== null).toBe(!parent)
    expect(host.textContent).not.toContain('фото проверено')
  } finally { await act(async () => root.unmount()); host.remove() }
})

// The same placement is read through the real DayPage adapter in both roles.
it.each([true, false])('shows olympiad reading before its test, parent=%s', async parent => {
  const id = 'family-olympiad'
  const extra = { id, title: 'Практика', detail: '', source: 'Education', kind: 'written' as const, status: 'unknown' as const, optional: true, learningContext: { kind: 'olympiad' as const, id: 'o1' } }
  scene.quizSlug = 'training-parity-v1'
  scene.page = { ...page(), familyId: 'family', childId: 'child', subjects: [{ ...page().subjects[0], tasks: [extra] }], testPlacements: [{ token: 'diagrams-test', subjectId: 'math', optional: true }] }
  scene.role = parent ? 'parent' : 'student'
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<DayPage token="role-day" parent={parent} headerReturnTarget={null} olympiadScope={{ familyId: 'family', childId: 'child', olympiadId: 'o1', taskId: id, testTokens: ['diagrams-test'] }} />))
    const card = host.querySelector('[aria-label="Тест: Чётность и сумма"]')!
    expect(card.textContent).toContain('Чётное число делится на 2 без остатка')
    expect(card.textContent).not.toContain('Самопроверка по теме.')
    expect(card.textContent).toContain(parent ? 'Посмотреть вопросы' : 'Пройти тест')
  } finally { await act(async () => root.unmount()); host.remove() }
})

// Separating the visual sections does not create a second day subscription or duplicate tests.
it.each([true, false])('places tests in a separate olympiad section for parent=%s', async parent => {
  const id = 'family-olympiad'
  const extra = { id, title: 'Практическая задача', detail: '', source: 'Education', kind: 'written' as const, status: 'unknown' as const, optional: true, learningContext: { kind: 'olympiad' as const, id: 'o1' } }
  scene.page = { ...page(), familyId: 'family', childId: 'child', subjects: [{ ...page().subjects[0], tasks: [extra] }], testPlacements: [{ token: 'diagrams-test', subjectId: 'math', optional: true }] }
  scene.role = parent ? 'parent' : 'student'
  const host = document.createElement('div'); const target = document.createElement('div'); document.body.append(target, host); const root = createRoot(host)
  try {
    await act(async () => root.render(<DayPage token="role-day" parent={parent} headerReturnTarget={null} olympiadScope={{ familyId: 'family', childId: 'child', olympiadId: 'o1', taskId: id, testTokens: ['diagrams-test'], quizTarget: target }} />))
    expect(target.querySelectorAll('.day-quiz-lineage')).toHaveLength(1)
    expect(host.querySelector('.day-quiz-lineage')).toBeNull()
    expect(host.textContent).toContain('Практическая задача')
    expect(target.textContent).not.toContain('Практическая задача')
  } finally { await act(async () => root.unmount()); target.remove(); host.remove() }
})

it.each([true, false])('shows contest source and preserves upload without AI help for parent=%s', async parent => {
  const task = { id: 'contest-problem', title: 'Задача 1', detail: 'Условие на фото.', source: 'Education', kind: 'written' as const, status: 'unknown' as const, optional: true, competitionUntil: '2999-01-01T00:00:00.000Z', learningContext: { kind: 'olympiad' as const, id: 'o1' } }
  scene.page = { ...page(), familyId: 'family', childId: 'child', subjects: [{ ...page().subjects[0], tasks: [task] }], testPlacements: [] }
  scene.role = parent ? 'parent' : 'student'
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<DayPage token="role-day" parent={parent} headerReturnTarget={null} olympiadScope={{ familyId: 'family', childId: 'child', olympiadId: 'o1', taskId: task.id, testTokens: [] }} />))
    const card = host.querySelector<HTMLDetailsElement>('.problem-card')!
    await act(async () => { card.open = true; card.dispatchEvent(new Event('toggle')) })
    expect(card.textContent).toContain('подсказки и автоматическая проверка недоступны')
    expect(card.textContent).not.toContain('Попросить помощь')
    expect(Boolean(card.querySelector('input[type=file]'))).toBe(!parent)
  } finally { await act(async () => root.unmount()); host.remove() }
})

it.each([true, false])('marks a linked source photo as added to olympiad practice, parent=%s', async parent => {
  const id = 'family-intake', uploadId = 'photo-12345678901234567890'
  const task = { id, title: 'Свои задачи', detail: '', source: 'Education', kind: 'written' as const, status: 'unknown' as const, optional: true, sourceIntake: { kind: 'olympiad-sheet' as const }, learningContext: { kind: 'olympiad' as const, id: 'o1' } }
  scene.page = { ...page(), familyId: 'family', childId: 'child', subjects: [{ ...page().subjects[0], tasks: [task] }], testPlacements: [] }
  scene.uploads = [{ id: `student-token:${uploadId}`, taskId: id, status: 'pending' }]
  scene.role = parent ? 'parent' : 'student'
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<DayPage token="role-day" parent={parent} headerReturnTarget={null} olympiadScope={{ familyId: 'family', childId: 'child', olympiadId: 'o1', taskId: id, testTokens: [], sourcePhotoIds: [uploadId] }} />))
    expect(host.textContent).toContain('задачи добавлены в практику')
    expect(host.textContent).not.toContain('обработка условий ожидается')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('queue keeps a confirmed local photo matched with its saved copy', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { default: Queue } = await import('./components/OlympiadSourceQueue')
  const html = renderToStaticMarkup(<Queue parent studentToken="student-token" uploads={[{ id:'student-token:photo', taskId:'intake', status:'pending' }]} localPhotos={[{ id:'photo', taskId:'intake', state:'saved', previewUrl:'blob:demo' }]} processedIds={['photo']} now={0} onPhotos={() => {}} />)
  expect(html).toContain('задачи добавлены в практику')
  expect(html).not.toContain('обработка условий ожидается')
})

it.each([true, false])('uses the shared condition for source tasks with missing transcript, parent=%s', async parent => {
  const task = { id: 'source-pending', title: 'Задача', detail: 'Открой фотографию с условием задачи.', source: 'Education', kind: 'written' as const, status: 'unknown' as const, optional: true, learnerOrigin: { intakeTaskId:'intake', uploadIds:['photo-12345678901234567890'] }, learningContext: { kind: 'olympiad' as const, id: 'o1' } }
  scene.page = { ...page(), familyId:'family', childId:'child', subjects:[{...page().subjects[0],tasks:[task]}],testPlacements:[] }
  scene.role = parent ? 'parent' : 'student'
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  try {
    await act(async()=>root.render(<DayPage token="role-day" parent={parent} headerReturnTarget={null} olympiadScope={{familyId:'family',childId:'child',olympiadId:'o1',taskId:task.id,testTokens:[]}} />))
    expect(host.textContent).not.toContain('Открой фотографию с условием задачи.')
    expect(host.textContent).toContain('Точная текстовая запись этого номера ещё не подготовлена')
  } finally { await act(async()=>root.unmount());host.remove() }
})

it.each([true, false])('shows a parent guide only after contest restriction, restricted=%s', async restricted => {
  const task = { id:'source-guide', title:'Задача', detail:'Текст условия.', source:'Education', kind:'written' as const,status:'unknown' as const,optional:true,competitionUntil:restricted?'2999-01-01T00:00:00Z':'2000-01-01T00:00:00Z',learningContext:{kind:'olympiad' as const,id:'o1'} }
  scene.page={...page(),familyId:'family',childId:'child',subjects:[{...page().subjects[0],tasks:[task]}],testPlacements:[]}
  scene.guides={[task.id]:{guide:{kind:'worked-solution',presentation:'math-route',overview:'Подготовленный разбор',stages:[]}}}
  scene.role='parent'
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  try {
    await act(async()=>root.render(<DayPage token="role-day" parent headerReturnTarget={null} olympiadScope={{familyId:'family',childId:'child',olympiadId:'o1',taskId:task.id,testTokens:[]}} />))
    expect(Boolean(host.querySelector('.day-parent-guide'))).toBe(!restricted)
    expect(host.querySelector('input[type=file]')).toBeNull()
  } finally {await act(async()=>root.unmount());host.remove()}
})

it.each(['requested', 'pending'] as const)('names %s PDF work without calling it a photo in the ordinary day card', async status => {
  scene.page!.subjects = [{id:'math',name:'Математика',icon:'∑',materials:'',mesh:'Записать решение',summary:'',tasks:[{id:'file-solution',kind:'written',status:'unknown',title:'Решение в документе',detail:'Запиши решение.',source:'МЭШ'}]}]
  scene.uploads = [{id:'student-token:pdf',taskId:'file-solution',status,contentType:'application/pdf',originalName:'solution.pdf'}]
  sessionStorage.setItem('education-day-initial-tab','homework')
  const view = await renderPage(false)
  try {
    expect(view.host.textContent).toContain(status === 'requested' ? 'Файл загружается' : 'Новая работа · ждёт проверки')
    expect(view.host.textContent).not.toContain('Фото загружается')
    expect(view.host.textContent).not.toContain('Новое фото · ждёт проверки')
  } finally { await view.cleanup() }
})

it.each([false,true])('collapses every ordinary assignment on entry while keeping titles and exact statuses, parent=%s',async(parent)=>{
 scene.page!.subjects=[{id:'math',name:'Математика',icon:'∑',materials:'',mesh:'Два назначения.',summary:'',tasks:[
  {id:'fett',kind:'written',status:'unknown',title:'ФЕТТ: пройти отборочный тур на каникулах',detail:'Полное задание учителя.',source:'МЭШ'},
  {id:'cdz',kind:'check',status:'unknown',title:'ЦДЗ: действия с обыкновенными и десятичными дробями',detail:'Выполнить ЦДЗ.',source:'МЭШ'},
 ]}]
 scene.page!.testPlacements=[];scene.page!.materialLinks={};scene.uploads=[];scene.reviews=[]
 const view=await renderPage(parent)
 try{
  const cards=view.host.querySelectorAll<HTMLDetailsElement>('.edu-task-disclosure.day-task')
  expect(cards,view.host.innerHTML.slice(-7500)).toHaveLength(2)
  for(const card of cards){expect(card.tagName).toBe('DETAILS');expect(card.open).toBe(false);expect(card.querySelector(':scope > summary')?.textContent).toContain('Задание');expect(card.querySelector(':scope > summary .edu-task-title')?.textContent).toBeTruthy();expect(card.querySelector(':scope > summary .edu-task-summary-status')?.textContent).toBeTruthy()}
  expect(cards[0].id).toBe('day-task-fett')
  await act(async()=>cards[0].querySelector('summary')!.click());expect(cards[0].open).toBe(true)
  await act(async()=>cards[0].querySelector('summary')!.click());expect(cards[0].open).toBe(false)
 }finally{await view.cleanup()}
})


it.each(['student-token','foreign-token'])('opens a canonical source request in its parent projection only for the same day: %s',async(requested)=>{
 scene.page!.subjects=[{id:'english',name:'Английский язык',icon:'',materials:'',mesh:'Запись',summary:'',tasks:[{id:'previous-work',kind:'written',status:'unknown',title:'Уже присланные страницы',detail:'Сохранённая работа',source:'МЭШ'}]}]
 scene.page!.studentToken='student-token';scene.page!.testPlacements=[];scene.page!.materialLinks={};scene.uploads=[];scene.reviews=[];scene.role='parent'
 sessionStorage.setItem('education-day-focus-task',JSON.stringify({dayToken:requested,taskId:'previous-work'}))
 const oldFrame=window.requestAnimationFrame,oldCancel=window.cancelAnimationFrame,oldScroll=HTMLElement.prototype.scrollIntoView
 window.requestAnimationFrame=cb=>{cb(0);return 1};window.cancelAnimationFrame=()=>{};HTMLElement.prototype.scrollIntoView=()=>{}
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{await act(async()=>root.render(<DayPage token="parent-token" parent headerReturnTarget={null}/>));expect(host.querySelector<HTMLDetailsElement>('#day-task-previous-work')!.open).toBe(requested==='student-token')}
 finally{await act(async()=>root.unmount());host.remove();window.requestAnimationFrame=oldFrame;window.cancelAnimationFrame=oldCancel;HTMLElement.prototype.scrollIntoView=oldScroll}
})

it.each(['ordinary','quiz'])('opens only the explicitly targeted %s assignment and respects a later manual close',async(kind)=>{
 const tasks=kind==='ordinary'?[{id:'focus-task',kind:'written' as const,status:'unknown' as const,title:'Моё задание',detail:'Подробности',source:'МЭШ'}]:[{id:'focus-task',kind:'read' as const,status:'unknown' as const,title:'Прочитать параграф',detail:'Подробности',source:'МЭШ',testToken:'diagrams-test'}]
 scene.page!.subjects=[{id:'math',name:'Математика',icon:'∑',materials:'',mesh:'Назначение.',summary:'',tasks}];scene.page!.materialLinks={};scene.page!.testPlacements=kind==='quiz'?[{token:'diagrams-test',subjectId:'math',taskId:'focus-task'}]:[];scene.uploads=[];scene.reviews=[]
 sessionStorage.setItem('education-day-focus-task',JSON.stringify({dayToken:'student-token',taskId:kind==='quiz'?'quiz:diagrams-test':'focus-task'}))
 const priorFrame=window.requestAnimationFrame,priorCancel=window.cancelAnimationFrame,priorScroll=HTMLElement.prototype.scrollIntoView
 window.requestAnimationFrame=cb=>{cb(0);return 1};window.cancelAnimationFrame=()=>{};HTMLElement.prototype.scrollIntoView=()=>{}
 const view=await renderPage(false)
 try{
  const card=view.host.querySelector<HTMLDetailsElement>('#day-task-focus-task')!
  expect(card.tagName).toBe('DETAILS');expect(card.open).toBe(true)
  await act(async()=>card.querySelector('summary')!.click());expect(card.open).toBe(false)
  await act(async()=>view.root.render(<DayPage token="student-token" parent={false} headerReturnTarget={null}/>));expect(card.open).toBe(false)
 }finally{await view.cleanup();window.requestAnimationFrame=priorFrame;window.cancelAnimationFrame=priorCancel;HTMLElement.prototype.scrollIntoView=priorScroll}
})

it.each([true, false])('preserves the private guide beside a quiz-only reading task for parent=%s', async(parent)=>{
 const current=page()
 current.subjects[0].tasks=[{id:taskId,kind:'read',status:'unknown',title:'Повторить урок',detail:'',source:'МЭШ',testToken:'diagrams-test'}]
 current.materialLinks={};scene.page=current
 scene.guides={[taskId]:{guide:{kind:'structured-notes',overview:'Закрытая сверка конкретной попытки',stages:[{id:'omission',title:'Пропущен один вариант',expected:'Полный ответ только взрослому',source:{kind:'textbook',label:'Сверенный оригинал',ref:'book:31',excerpt:'точный источник'}}]}}}
 const view=await renderPage(parent)
 try{
  expect(view.host.querySelectorAll('.day-quiz-lineage')).toHaveLength(1)
  expect(view.host.textContent?.includes('Закрытая сверка конкретной попытки')).toBe(parent)
  expect(view.host.textContent?.includes('Полный ответ только взрослому')).toBe(parent)
  expect(view.host.querySelectorAll('.day-task')).toHaveLength(0)
 }finally{await view.cleanup()}
})

/** The actual linked-quiz consumer must keep a context receipt inside its assignment. */
it.each([false,true])('shows a received CDZ result without asking for it again, but does not credit reading (parent=%s)',async parent=>{
 const id='mesh-geography'
 scene.page!.subjects=[{id:'geography',name:'География',icon:'🌍',materials:'',mesh:'п.39,ЦДЗ',summary:'',tasks:[{id,title:'§39 и ЦДЗ',kind:'check',status:'unknown',detail:'Повторить §39 и выполнить ЦДЗ.',meshText:'п.39,ЦДЗ',source:'МЭШ'}]}]
 scene.page!.testPlacements=[];scene.guides={};scene.uploads=[]
 scene.reviews=[{id:'context',taskId:id,contextEvidence:[{id:'receipt',purpose:'context-evidence',type:'platform-result',title:'Атмосфера',points:4,maxPoints:4,duration:7,observedDate:'2026-11-21',uploadId:'screenshot',location:'Карточка результата',summary:'Результат назначенного ЦДЗ сохранён; чтение отдельно не подтверждено.'}]}]
 const view=await renderPage(parent)
 try{
  const card=view.host.querySelector<HTMLDetailsElement>(`#day-task-${id}`)!
  await act(async()=>card.querySelector<HTMLElement>('summary')!.click())
  expect(card.textContent).toContain('Атмосфера: 4/4')
  expect(card.textContent).toContain('Результат ЦДЗ сохранён')
  expect(card.textContent).not.toContain('Результат ЦДЗ пока не подтверждён')
  expect(card.textContent).not.toContain('Нужен скриншот результата ЦДЗ')
  expect(card.textContent).not.toContain('Загрузить результат ЦДЗ')
  expect(scene.reviews[0].status).toBeUndefined()
  expect(scene.page!.subjects[0].tasks[0].status).toBe('unknown')
 }finally{await view.cleanup()}
})
it.each([[false,false],[false,true],[true,false],[true,true]])('keeps a distinct context receipt with the linked selftest (parent=%s, placed=%s)',async(parent,placed)=>{
 const id='mesh-geography'
 scene.page!.subjects=[{id:'geography',name:'География',icon:'🌍',materials:'',mesh:'п.38',summary:'',tasks:[{id,title:'Гидросфера и человек',kind:'read',status:'unknown',detail:'Прочитай §38.',meshText:'п.38',source:'МЭШ',testToken:'diagrams-test'}]}]
 scene.page!.testPlacements=placed?[{token:'diagrams-test',subjectId:'geography',taskId:id}]:[]
 scene.quizSubmitted=true;scene.quizSubject='География';scene.decisions=[];scene.guides={};scene.uploads=[]
 scene.reviews=[{id:'context',taskId:id,contextEvidence:[{id:'receipt',purpose:'context-evidence',type:'platform-result',title:'Гидросфера',points:10,maxPoints:10,duration:3,observedDate:'2026-11-16',uploadId:'screenshot',location:'Карточка результата',summary:'Сохранён результат на присланном снимке.'}]}]
 const view=await renderPage(parent)
 try{
  const card=view.host.querySelector<HTMLDetailsElement>(`#day-task-${id}`)!
  expect(card).not.toBeNull();expect(card.open).toBe(false)
  await act(async()=>card.querySelector<HTMLElement>('summary')!.click())
  expect(card.open).toBe(true)
  expect(card.querySelector('.day-quiz-lineage-score')?.textContent).toContain('8 из 8')
  expect(card.textContent).toContain('Результат сохранён')
  expect(card.textContent).toContain('Гидросфера: 10/10')
  expect(view.host.querySelectorAll('.day-review-stack')).toHaveLength(1)
  expect(view.host.querySelectorAll(`#day-task-${id}`)).toHaveLength(1)
  expect(card.querySelector('input[type=file]')).toBeNull()
  expect(card.textContent).not.toContain('Что исправить')
  expect(scene.reviews[0].status).toBeUndefined()
  expect(scene.quizChoiceCalls).toEqual([])
 }finally{await view.cleanup()}
})

it.each([false,true])('keeps original submission requirements historical after a specific partial review (parent=%s)',async parent=>{
 const id='mesh-biology',original='Изучить §8. Письменно ответить на вопросы 5, 6, 7.'
 scene.page!.subjects=[{id:'biology',name:'Биология',icon:'🌱',materials:'',mesh:original,summary:'',tasks:[{id,title:'§8, вопросы 5–7',kind:'written',status:'partial',detail:original,meshText:original,source:'МЭШ',submission:{buttonLabel:'Прислать дополнение',lead:'Пришли свою запись трёх ответов на вопросы 5, 6, 7.',items:['Вопрос 5 — строение.','Вопрос 6 — расположение.','Вопрос 7 — связь.'],photo:'Должны читаться номера 5, 6, 7.'}}]}]
 scene.page!.testPlacements=[];scene.decisions=[];scene.guides={}
 scene.uploads=[{id:'student-token:photo',taskId:id,status:'reviewed'}]
 scene.reviews=[{id:'checked',taskId:id,status:'partial',checkedAt:{seconds:100},studentFeedback:{title:'Уточни одну связь',confirmed:'Ответы на вопросы 5 и 6 приняты.',focus:'В вопросе 7 нужна одна связь.',question:'Как расположение частей помогает их работе?'},nextStep:'Уточни только связь в вопросе 7.'}]
 const view=await renderPage(parent)
 try{
  const card=view.host.querySelector<HTMLDetailsElement>(`#day-task-${id}`)!
  expect(card.querySelector('.edu-review-question')?.textContent).toContain('Как расположение частей помогает их работе?')
  expect(card.textContent).toContain('Ответы на вопросы 5 и 6 приняты.')
  const historical=card.querySelector<HTMLDetailsElement>('details.day-submission-instructions')
  expect(historical).not.toBeNull();expect(historical!.open).toBe(false)
  expect(historical!.querySelector('summary')?.textContent).toBe('Первоначальные требования к сдаче')
  expect(historical!.textContent).toContain('Пришли свою запись трёх ответов на вопросы 5, 6, 7.')
  expect(historical!.textContent).toContain('Должны читаться номера 5, 6, 7.')
  expect(card.textContent).not.toContain('Что исправить и сфотографировать')
  expect(card.querySelector<HTMLInputElement>('input[type=file]')!==null).toBe(!parent)
  await act(async()=>historical!.querySelector<HTMLElement>('summary')!.click())
  expect(historical!.open).toBe(true)
  expect(historical!.querySelectorAll('li')).toHaveLength(3)
 }finally{await view.cleanup()}
})

// @see ../docs/modules/school-diary/day-page.md#stage-assessments
it.each([true, false])('keeps canonical written evidence beside a quiz-owned teacher task parent=%s', async (parent) => {
  scene.page!.subjects[0].tasks = [{ ...scene.page!.subjects[0].tasks[0], problems: undefined, practiceVariants: undefined, outputKind: 'structured-notes' }]
  const view = await renderPage(parent)
  try {
    const card = view.host.querySelector(`#day-task-${taskId}`)!
    expect(card).not.toBeNull()
    expect(Boolean(card.querySelector('input[type="file"]'))).toBe(!parent)
  } finally { await view.cleanup() }
})

it.each([true,false])('shows the linked stage result and opens its existing quiz in role parent=%s',async parent=>{
 const source=scene.page!.subjects[0].tasks[0]
 const task={...source,kind:'written' as const,problems:undefined,practiceVariants:undefined,stageAssessments:[{stageId:'evidence',title:'Готовность к ответу',scope:'Проверка по тексту; не запись устной речи.',token:'diagrams-test'}]}
 scene.page!.subjects[0].tasks=[task]
 scene.quizSubmitted=true
 scene.quizOptional=true
 const review={id:'student-token:review',taskId,checkedAt:{seconds:1,nanoseconds:0},status:'cannot-assess' as const,checkableStageIds:['assignment','evidence'],items:[{stageId:'assignment',label:'Письменно',status:'correct' as const},{stageId:'evidence',label:'Готовность',status:'cannot-assess' as const}]}
 scene.reviews=[review]
 scene.guides={[taskId]:{guide:{kind:'structured-notes',presentation:'learning-route',overview:'Закрытый разбор',stages:[{id:'evidence',title:'Готовность к ответу',expected:'PRIVATE_PARENT_EXPECTED',source:{kind:'textbook',label:'Оригинал',ref:'book:1',excerpt:'Read.'}}]}}}
 const view=await renderPage(parent)
 try{
  const link=view.host.querySelector('[data-stage-assessment="evidence"]')!
  expect(link?.textContent).toContain('Подтверждено тестом · 8 из 8')
  expect(link.querySelector('a')?.getAttribute('href')).toBe('#/t/diagrams~diagrams-test')
  expect(view.host.querySelector(`#day-task-${taskId}`)?.textContent).toContain('Готово · проверено')
  if(!parent)expect(view.host.textContent).not.toContain('PRIVATE_PARENT_EXPECTED')
  expect(scene.reviews[0]).toEqual(review)
 }finally{await view.cleanup()}
})

// @see ../docs/modules/assignments/source-units.md
it.each(['english','russian','literature'])('renders source-bound exercise units before explanations for %s in both roles',async subjectId=>{
 for(const parent of [true,false]){
  const task:DayTask={...scene.page!.subjects[0].tasks[0],kind:'written' as const,problems:undefined,practiceVariants:undefined,testToken:undefined,
   assignmentUnits:{version:1,sourceText:'Упражнения 1 и 2.',items:[
    {id:'exercise-1',title:'Упражнение 1',kind:'written',sourceRefs:['starlight-6-2022#44'],original:'Write the phrases.',instructions:['Выпиши пять словосочетаний.']},
    {id:'exercise-2',title:'Упражнение 2',kind:'oral',sourceRefs:['starlight-6-2022#44'],original:'Read and answer.',instructions:['Ответь на вопросы по прочитанному тексту.']}
   ]},meshText:'Упражнения 1 и 2.'}
  scene.page!.subjects=[{...scene.page!.subjects[0],id:subjectId,tasks:[task]}]
  scene.page!.testPlacements=[]
  scene.page!.materialLinks={[taskId]:[{title:'Книга',sourceType:'textbook-page',sourceRef:'starlight-6-2022#pdf-0044',pdfPage:44,printedPage:44,url:'https://disk.yandex.ru/d/synthetic'}]}
  sessionStorage.setItem('education-day-initial-tab','homework')
  const view=await renderPage(parent)
  try{
   const cards=view.host.querySelectorAll('[data-assignment-unit]')
   expect(cards).toHaveLength(2)
   for(const card of cards){
    expect(card.hasAttribute('open')).toBe(false)
    expect(card.querySelector('.day-reader')).not.toBeNull()
    expect(card.querySelector('.day-reader')!.compareDocumentPosition(card.querySelector('.assignment-unit-instructions')!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(card.getAttribute('data-decision-nodes')).toContain('artifact.units')
   }
   expect(Boolean(cards[0].querySelector('input[type=file]'))).toBe(!parent)
   expect(view.host.querySelectorAll(`#day-task-${taskId}`)).toHaveLength(1)
  }finally{await view.cleanup()}
 }
})

it.each([true,false])('keeps the existing quiz in its unit context and preserves open state and role boundaries parent=%s',async parent=>{
 const task:DayTask={...scene.page!.subjects[0].tasks[0],kind:'written',problems:undefined,practiceVariants:undefined,testToken:undefined,meshText:'Упр.1 и2.',assignmentUnits:{version:1,sourceText:'Упр.1 и2.',items:[
  {id:'one',title:'Упр.1',kind:'written',sourceRefs:['starlight-6-2022#44'],original:'Write.',instructions:['Выпиши слова.'],guideStageIds:['assignment']},
  {id:'two',title:'Упр.2',kind:'oral',sourceRefs:['starlight-6-2022#44'],original:'Read.',instructions:['Прочитай и ответь.'],guideStageIds:['evidence'],quizToken:'diagrams-test'}
 ]}}
 scene.page!.subjects[0].tasks=[task]
 scene.page!.testPlacements=[{subjectId:'math',token:'diagrams-test',optional:true}]
 scene.page!.materialLinks={[taskId]:[{title:'Книга',sourceType:'textbook-page',sourceRef:'starlight-6-2022#pdf-0044',pdfPage:44,printedPage:44,url:'https://disk.yandex.ru/d/synthetic'}]}
 scene.guides={[taskId]:{guide:{kind:'structured-notes',presentation:'learning-route',revision:2,overview:'Разбор',stages:[{id:'assignment',title:'Запись',expected:'PRIVATE_FIRST',source:{label:'Книга'}},{id:'evidence',title:'Вопрос',expected:'PRIVATE_SECOND',source:{label:'Книга'}}]}}}
 const view=await renderPage(parent)
 try{
  expect(view.host.querySelectorAll('#day-quiz-diagrams-test')).toHaveLength(1)
  expect(view.host.querySelector('#day-unit-mesh-diagrams-two #day-quiz-diagrams-test')).not.toBeNull()
  expect(view.host.querySelector('#day-unit-mesh-diagrams-one')?.textContent).not.toContain('PRIVATE_SECOND')
  if(!parent)expect(view.host.textContent).not.toContain('PRIVATE_')
  const first=view.host.querySelector<HTMLDetailsElement>('#day-unit-mesh-diagrams-one')!
  await act(async()=>{first.open=true})
  scene.quizSubmitted=true
  await act(async()=>view.root.render(<DayPage token="student-token" parent={parent} headerReturnTarget={null}/>))
  expect(first.open).toBe(true)
  expect(view.host.querySelector('#day-quiz-diagrams-test')?.textContent).toContain('100%')
 }finally{await view.cleanup()}
})

it.each([true,false])('keeps a whole-reading quiz once after chapter units without duplicate test actions or a reading-photo demand parent=%s',async parent=>{
 const task:DayTask={...scene.page!.subjects[0].tasks[0],kind:'read',testSlug:'diagrams',problems:undefined,practiceVariants:undefined,meshText:'Прочитать главы1–2.',assignmentUnits:{version:1,sourceText:'Прочитать главы1–2.',items:[{id:'chapter-one',title:'Глава1',kind:'reading',sourceRefs:['source-page'],original:'Глава1',instructions:['Прочитай главу1.']},{id:'chapter-two',title:'Глава2',kind:'reading',sourceRefs:['source-page'],original:'Глава2',instructions:['Прочитай главу2.']}]}}
 scene.page!.subjects[0].tasks=[task]
 const view=await renderPage(parent)
 try{
  const card=view.host.querySelector(`#day-task-${taskId}`)!
  expect(card.querySelectorAll('#day-quiz-diagrams-test')).toHaveLength(1)
  expect(card.querySelector('.day-task-actions .day-quiz-link')).toBeNull()
  expect(card.querySelector('input[type=file]')).toBeNull()
 }finally{await view.cleanup()}
})

it('keeps a non-reader teacher original linked before decoding instead of dropping it when grouped into a unit',async()=>{
 const task:DayTask={...scene.page!.subjects[0].tasks[0],kind:'written',problems:undefined,practiceVariants:undefined,testToken:undefined,meshText:'Упражнение1.',assignmentUnits:{version:1,sourceText:'Упражнение1.',items:[{id:'one',title:'Упражнение1',kind:'written',sourceRefs:['teacher-file'],original:'Write.',instructions:['Выполни упражнение.']}]}}
 scene.page!.subjects[0].tasks=[task];scene.page!.testPlacements=[]
 scene.page!.materialLinks={[taskId]:[{title:'Оригинал учителя.pdf',sourceType:'teacher-attachment',sourceRef:'teacher-file',url:'https://example.org/teacher.pdf'}]}
 const view=await renderPage(false)
 try{
  const card=view.host.querySelector('.assignment-unit')!,link=card.querySelector('a[href="https://example.org/teacher.pdf"]')!
  expect(link).not.toBeNull()
  expect(link.compareDocumentPosition(card.querySelector('.assignment-unit-instructions')!)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
 }finally{await view.cleanup()}
})
