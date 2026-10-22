import { describe, expect, it } from 'vitest'
import { dayPageShapeErrors, dayDashboardShapeErrors, assignmentShapeErrors } from './data-contract.mjs'
import { mixedEntryActions } from './mixed-assignment.mjs'

const page = () => ({ schemaVersion: 1, kind: 'parent', date: '2026-10-12', targetDate: '2026-10-13',
  boardToken: 'parent', studentToken: 'student', familyId: 'family', childId: 'child',
  subjects: [{ id: 'history', tasks: [{ id: 'mesh-1', title: 'Прочитать § 7', kind: 'read', status: 'unknown' }] }], testPlacements: [] })
describe('строгий контракт основных документов Firestore', () => {
  it('accepts both exact split actions but rejects a missing child in the published shape', () => {
    const p = page(), rawText = 'упр.4(пис),упр.6(повторить правило) стр.31'
    p.subjects[0].tasks = mixedEntryActions({id:'123',description:rawText}).map(entry=>({id:`mesh-${entry.id}`,meshText:entry.description,title:entry.description,kind:'check',status:'unknown'}))
    const actionIds=p.subjects[0].tasks.map(task=>task.id)
    p.sourceOnlyEntries=[{kind:'split',id:'mesh-123',subjectId:'history',rawText,actionIds,targetTaskId:actionIds[0],reason:'Два отдельных действия'}]
    expect(dayPageShapeErrors(p)).toEqual([])
    p.subjects[0].tasks.pop()
    expect(dayPageShapeErrors(p).length).toBeGreaterThan(0)
  })
  it('отвергает неполную семейную привязку и закрытый разбор в открытом дне', () => {
    const p = page(); delete p.childId; p.subjects[0].tasks[0].parentGuide = { answer: 'secret' }
    expect(dayPageShapeErrors(p).join(' ')).toMatch(/Семья и ребёнок/)
    expect(dayPageShapeErrors(p).join(' ')).toMatch(/Закрытый родительский/)
  })
  it('разрешает дополнительные поля для совместимости, но запрещает неизвестную версию', () => {
    const p = page(); p.newOptionalField = 'future'
    expect(dayPageShapeErrors(p)).toEqual([])
    p.schemaVersion = 2
    expect(dayPageShapeErrors(p)).toContain('Неизвестная версия страницы дня.')
  })
  it('accepts an exact public notice without a task target and rejects malformed discriminated entries', () => {
    const p = page()
    p.sourceOnlyEntries = [{ kind: 'notice', id: 'mesh-352682606', subjectId: 'math', rawText: 'Всем хороших каникул!', reason: 'Источник' }]
    expect(dayPageShapeErrors(p)).toEqual([])
    p.sourceOnlyEntries[0].targetTaskId = 'mesh-352682606'
    expect(dayPageShapeErrors(p).join(' ')).toMatch(/Ссылки и уведомления МЭШ/)
  })
  it('требует уникальные даты и вопросы', () => {
    const day = { date: '2026-10-13', schedule: [], homework: [], dayToken: null }
    expect(dayDashboardShapeErrors({ schemaVersion: 1, kind: 'parent', timezone: 'Europe/Moscow', days: [day, day] }).join(' ')).toMatch(/повторяется/)
    expect(assignmentShapeErrors({ testId: 't', title: 'Тест', subject: 'История', status: 'open',
      questions: [{ id: 'q', prompt: 'Вопрос' }, { id: 'q', prompt: 'Другой вопрос' }] }).join(' ')).toMatch(/повторяется/)
  })
})
