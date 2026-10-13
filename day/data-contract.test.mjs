import { describe, expect, it } from 'vitest'
import { dayPageShapeErrors, dayDashboardShapeErrors, assignmentShapeErrors } from './data-contract.mjs'

const page = () => ({ schemaVersion: 1, kind: 'parent', date: '2026-10-12', targetDate: '2026-10-13',
  boardToken: 'parent', studentToken: 'student', familyId: 'family', childId: 'child',
  subjects: [{ id: 'history', tasks: [{ id: 'mesh-1', title: 'Прочитать § 7', kind: 'read', status: 'unknown' }] }], testPlacements: [] })
describe('строгий контракт основных документов Firestore', () => {
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
  it('требует уникальные даты и вопросы', () => {
    const day = { date: '2026-10-13', schedule: [], homework: [], dayToken: null }
    expect(dayDashboardShapeErrors({ schemaVersion: 1, kind: 'parent', timezone: 'Europe/Moscow', days: [day, day] }).join(' ')).toMatch(/повторяется/)
    expect(assignmentShapeErrors({ testId: 't', title: 'Тест', subject: 'История', status: 'open',
      questions: [{ id: 'q', prompt: 'Вопрос' }, { id: 'q', prompt: 'Другой вопрос' }] }).join(' ')).toMatch(/повторяется/)
  })
})
