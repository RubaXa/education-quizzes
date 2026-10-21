import { describe, expect, it } from 'vitest'
import { mergeDayPage } from './merge.mjs'

const task = (id, status = 'unknown') => ({ id, title: id, detail: id, status, kind: 'written', source: 'МЭШ' })
const subject = (tasks) => ({ id: 'math', name: 'Математика', icon: '∑', materials: 'Учебник', mesh: 'ДЗ', summary: 'Сделать', tasks })
const page = (tasks, evidenceDayTokens = ['today']) => ({
  date: '2026-10-08', targetDate: '2026-10-09', updatedAt: 'now',
  subjects: [subject(tasks)], taskIds: tasks.map((item) => item.id),
  evidenceDayTokens, materialLinks: {}, testPlacements: [],
  todaySchedule: [], targetSchedule: [],
})

describe('повторный выпуск страницы дня', () => {
  it('publishes variant IDs beside one MESH assignment and keeps them on a repeat', () => {
    const withVariants = { ...task('mesh-351641344'), kind: 'check',
      practiceVariants: [{ id: 'mesh-351641344-v1', title: 'Вариант 1' }, { id: 'mesh-351641344-v2', title: 'Вариант 2' }],
      problems: [{ id: 'mesh-351641344-p-v1-001' }, { id: 'mesh-351641344-p-v2-001' }] }
    const first = mergeDayPage(null, page([withVariants]))
    const second = mergeDayPage(first, page([withVariants]))
    expect(second.taskIds).toEqual(['mesh-351641344', 'mesh-351641344-p-v1-001', 'mesh-351641344-p-v2-001'])
    expect(second.practiceVariantIds).toEqual(['mesh-351641344-v1', 'mesh-351641344-v2'])
  })
  it('сохраняет старые действия и подтверждённый статус, добавляя позднее ДЗ', () => {
    const old = page([task('old', 'verified')], ['today', 'yesterday'])
    const next = page([task('old'), task('new')])
    const merged = mergeDayPage(old, next)
    expect(merged.subjects[0].tasks.map((item) => item.id)).toEqual(['old', 'new'])
    expect(merged.subjects[0].tasks[0].status).toBe('verified')
    expect(merged.evidenceDayTokens).toEqual(['today', 'yesterday'])
    expect(merged.changes[0].added).toEqual(['new'])
  })

  it('не удаляет действие, исчезнувшее из очередного снимка', () => {
    const first = mergeDayPage(null, page([task('old')]))
    const second = mergeDayPage(first, page([]))
    expect(second.subjects[0].tasks.map((item) => item.id)).toEqual(['old'])
  })

  it('projects task→notice→task by the same source ID while retaining stored work history', () => {
    const old = { ...page([task('mesh-352682606', 'verified')]), uploads: [{ id: 'upload-old', taskId: 'mesh-352682606' }],
      reviews: [{ taskId: 'mesh-352682606', status: 'verified' }], testPlacements: [{ taskId: 'mesh-352682606', token: 'old-test', subjectId: 'math' }] }
    const notice = { ...page([]), sourceOnlyEntries: [{ kind: 'notice', id: 'mesh-352682606', subjectId: 'math',
      rawText: 'Всем хороших каникул!', reason: 'Exact notice' }] }
    const duringNotice = mergeDayPage(old, notice)
    expect(duringNotice.subjects[0].tasks).toEqual([])
    expect(duringNotice.taskIds).toEqual([])
    expect(duringNotice.sourceOnlyEntries).toEqual(notice.sourceOnlyEntries)
    expect(duringNotice.uploads).toEqual(old.uploads)
    expect(duringNotice.reviews).toEqual(old.reviews)
    expect(duringNotice.testPlacements).toEqual([])
    const restored = mergeDayPage(duringNotice, { ...page([task('mesh-352682606')]), sourceOnlyEntries: [] })
    expect(restored.subjects[0].tasks.map((item) => item.id)).toEqual(['mesh-352682606'])
    expect(restored.sourceOnlyEntries).toEqual([])
    expect(restored.uploads).toEqual(old.uploads)
    expect(restored.reviews).toEqual(old.reviews)
  })

  it('повтор с теми же данными не создаёт новую ревизию', () => {
    const first = mergeDayPage(null, page([task('old')]))
    const second = mergeDayPage(first, page([task('old')]))
    expect(second.planRevision).toBe(1)
    expect(second.changes).toEqual([])
  })

  it('не переносит старый результат ЦДЗ в изменённое письменное задание', () => {
    const oldTask = { ...task('mesh-42-cdz', 'verified'), kind: 'check', meshText: 'ЦДЗ по теме', platformResult: { state: 'completed', points: 8, maxPoints: 8 } }
    const nextTask = { ...task('mesh-42-cdz'), meshText: 'Решить задачу в тетради' }
    const merged = mergeDayPage(page([oldTask]), page([nextTask]))
    expect(merged.subjects[0].tasks[0].status).toBe('unknown')
    expect(merged.subjects[0].tasks[0].platformResult).toBeUndefined()
  })

  it('не переносит результат платформы в неявное ЦДЗ', () => {
    const oldTask = { ...task('mesh-42', 'verified'), meshText: 'Решить задачу', platformResult: { state: 'completed', points: 8, maxPoints: 8 } }
    const merged = mergeDayPage(page([oldTask]), page([oldTask]))
    expect(merged.subjects[0].tasks[0].platformResult).toBeUndefined()
  })

  it('снимает прежний разбор и закрытый ориентир с source-only карточки, сохраняя подтверждение и статус', () => {
    const oldTask = { ...task('mesh-42-cdz', 'verified'), kind: 'check', meshText: 'ЦДЗ по теме',
      steps: [{ text: 'Старый разбор' }], submission: { photo: 'Старое описание фото' },
      parentGuide: { stages: [{ id: 'private', answer: 'закрыто' }] }, cardPattern: 'unknown',
      outputKind: 'platform-result', testToken: 'a'.repeat(32), sourceInventory: { private: true },
      platformResult: { state: 'completed', points: 8, maxPoints: 8, source: 'МЭШ' } }
    const nextTask = { ...task('mesh-42-cdz'), kind: 'check', meshText: 'ЦДЗ по теме', detail: 'ЦДЗ по теме',
      instructionStatus: { state: 'needs-review', message: 'Пока видна точная запись МЭШ.' },
      materialStatus: { state: 'teacher-attachment-needed', message: 'Файл ещё не сопоставлен.' }, sourceOnly: true }
    const old = { ...page([oldTask], ['today', 'earlier']), uploads: [{ id: 'upload-history' }], reviews: [{ taskId: 'mesh-42-cdz' }] }
    const merged = mergeDayPage(old, page([nextTask]))
    const published = merged.subjects[0].tasks[0]
    for (const field of ['steps', 'submission', 'parentGuide', 'cardPattern', 'outputKind', 'testToken', 'sourceInventory']) {
      expect(published[field]).toBeUndefined()
    }
    expect(published.status).toBe('verified')
    expect(published.platformResult).toEqual(oldTask.platformResult)
    expect(merged.uploads).toEqual(old.uploads)
    expect(merged.reviews).toEqual(old.reviews)
    expect(merged.evidenceDayTokens).toEqual(['today', 'earlier'])
    expect(merged.testPlacements).toEqual([])
  })

  it('заменяет старый testPlacement того же taskId, не оставляя несуществующую ссылку', () => {
    const oldToken = 'a'.repeat(32), newToken = 'b'.repeat(32)
    const old = { ...page([{ ...task('mesh-42'), kind: 'read', testToken: oldToken }]), testPlacements: [{ taskId: 'mesh-42', subjectId: 'math', token: oldToken }] }
    const next = { ...page([{ ...task('mesh-42'), kind: 'read', testToken: newToken }]), testPlacements: [{ taskId: 'mesh-42', subjectId: 'math', token: newToken }] }
    const merged = mergeDayPage(old, next)
    expect(merged.testPlacements).toEqual([{ taskId: 'mesh-42', subjectId: 'math', token: newToken }])
    expect(merged.subjects[0].tasks[0].testToken).toBe(newToken)
  })
})
