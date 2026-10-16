import { describe, expect, it } from 'vitest'
import { lessonWorkItems, quizRequirement, requiredQuizRequirement } from './homeworkStatus'
import type { DayTask, DayWorkReview } from './dayStore'

/** @see ../../docs/modules/materials/material-clarification.md */
it('never treats requested notes, received photos or an identified topic as completed homework', () => {
  const task = { id:'notes',kind:'read',status:'verified',title:'Повторить записи',assessmentIntent:{state:'needs-topic'},
    materialRequest:{id:'notes-1',state:'open',question:'Какая тема записана в тетради?',photoPrompt:'Пришли фото записей последнего урока.'} } as DayTask
  expect(lessonWorkItems([task],[],[],[],{},{})).toMatchObject([{clarification:true,state:'todo'}])
  const uploads = [{id:'photo-1',taskId:'notes',status:'pending' as const}]
  expect(lessonWorkItems([task],uploads,[],[],{},{})).toMatchObject([{clarification:true,state:'checking'}])
  const review = {id:'notes',taskId:'notes',purpose:'source-material',sourceAnalysis:{requestId:'notes-1',topic:'Баллада',nextStep:'Уточним материал и подготовим проверку.'}} as DayWorkReview
  expect(lessonWorkItems([task],[],[review],[],{},{})).toMatchObject([{clarification:true,state:'checking'}])
})

/** @see ../../docs/modules/assessments/assessment-decision-graph.md#followup-threshold */
describe('one required self-check across its linked attempts', () => {
  const root = { root: { status: 'submitted', testId: 'english-1' } }
  const passed = { root: { points: 34, maxPoints: 39 } }

  it('counts a passing English test as done', () => {
    expect(quizRequirement('root', root, passed).state).toBe('done')
  })

  it('reopens after a parent request and follows the new attempt', () => {
    expect(quizRequirement('root', { root: { ...root.root, followupRequestedAt: true } }, passed).state).toBe('todo')
    const chain = { ...root, retry: { status: 'open', testId: 'english-2', linkedToTestId: 'english-1' } }
    expect(quizRequirement('root', chain, passed).state).toBe('todo')
    expect(quizRequirement('root', { ...chain, retry: { ...chain.retry, status: 'submitted' } },
      { ...passed, retry: { points: 9, maxPoints: 10 } }).state).toBe('done')
  })

  it('keeps 100% done until an explicit request and excludes an optional requested test', () => {
    const perfect = { root: { points: 5, maxPoints: 5 } }
    expect(quizRequirement('root', root, perfect).state).toBe('done')
    const requested = { root: { ...root.root, followupRequested: true } }
    expect(quizRequirement('root', requested, perfect)).toMatchObject({ state: 'todo', detail: 'Новый тест запрошен · ждём новый тест' })
    expect(requiredQuizRequirement('root', { root: { ...requested.root, familyOptional: true } }, perfect)).toBeNull()
  })

  it('requires correction below 85 percent', () => {
    expect(quizRequirement('root', root, { root: { points: 33, maxPoints: 40 } }).state).toBe('todo')
  })

  it('a parent request reopens even a previously verified reading task', () => {
    const task = { id: 'mesh-reading', title: 'Английский', kind: 'check', status: 'verified', testToken: 'root' } as DayTask
    const items = lessonWorkItems([task], [], [], [], { root: { ...root.root, followupRequested: true } }, passed)
    expect(items).toHaveLength(1)
    expect(items[0].state).toBe('todo')
  })

  it('excludes an optional chain across attempts and restores it when required again', () => {
    const chain = { root: { status: 'submitted', testId: 'math-1', familyOptional: true },
      retry: { status: 'open', testId: 'math-2', linkedToTestId: 'math-1' } }
    expect(quizRequirement('root', chain, {})).toEqual({ state: 'optional', detail: 'По желанию · не входит в итог' })
    expect(requiredQuizRequirement('root', chain, {})).toBeNull()
    expect(quizRequirement('root', { ...chain, root: { ...chain.root, familyOptional: false } }, {}).state).toBe('todo')
  })

  it('removes only the quiz from a teacher worksheet, preserving its problems', () => {
    const task = { id: 'mesh-math', title: 'Диаграммы', kind: 'check', status: 'unknown', testToken: 'root',
      problems: [{ id: 'math-p1', number: 1, title: 'Диаграмма', detail: '', source: 'Лист учителя' }] } as DayTask
    const optional = { root: { status: 'open', testId: 'math-1', familyOptional: true } }
    expect(lessonWorkItems([task], [], [], [], optional, {}).map((item) => item.id)).toEqual(['math-p1'])
    expect(lessonWorkItems([task], [], [], [], { root: { ...optional.root, familyOptional: false } }, {}).map((item) => item.id)).toEqual(['math-p1', 'quiz:root'])
  })

  it('removes an optional standalone reading check from required work without deleting its source', () => {
    const task = { id: 'mesh-read', title: 'Прочитать параграф', kind: 'read', status: 'unknown', testToken: 'root' } as DayTask
    expect(lessonWorkItems([task], [], [], [], { root: { status: 'open', familyOptional: true } }, {})).toEqual([])
  })
})

/** @see ../../docs/modules/school-diary/dashboard.md#homework-progress */
describe('reviewed written work in the next-homework overview', () => {
  const task = { id: 'mesh-russian', title: 'Упр. 218 и 223: выписать средства выразительности', kind: 'written' } as DayTask
  const base = { id: 'review', taskId: task.id, status: 'cannot-assess',
    studentFeedback: { title: '№ 218 проверен; № 223 не виден целиком', confirmed: 'Сравнения выписаны',
      focus: '№ 223 не виден', question: 'Покажи № 223 целиком' } } as DayWorkReview

  it('keeps the exact MESH requirement and names missing evidence without copying the long review', () => {
    const review = { ...base, summary: 'Длинный экспертный разбор не нужен в обзоре',
      assessmentBasis: { outcome: 'unresolved', unresolvedReason: 'missing-evidence' } } as DayWorkReview
    const [item] = lessonWorkItems([task], [], [review], [], {}, {})
    expect(item).toMatchObject({ state: 'unclear', unresolvedReason: 'missing-evidence',
      detail: '№ 218 проверен; № 223 не виден целиком' })
    expect(item.detail).not.toContain('Длинный экспертный разбор')
    expect(item.title).toContain('Упр. 218 и 223')
  })

  it('does not claim a missing photo when the criterion itself is uncertain', () => {
    const review = { ...base, summary: 'Длинное объяснение',
      assessmentBasis: { outcome: 'unresolved', unresolvedReason: 'criterion-unclear' } } as DayWorkReview
    const [item] = lessonWorkItems([task], [], [review], [], {}, {})
    expect(item).toMatchObject({ state: 'unclear', unresolvedReason: 'criterion-unclear',
      detail: 'Работа разобрана; основание неопределённости — в карточке.' })
  })
})
