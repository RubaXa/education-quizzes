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

  it('заменяет старый testPlacement того же taskId, не оставляя несуществующую ссылку', () => {
    const oldToken = 'a'.repeat(32), newToken = 'b'.repeat(32)
    const old = { ...page([{ ...task('mesh-42'), kind: 'read', testToken: oldToken }]), testPlacements: [{ taskId: 'mesh-42', subjectId: 'math', token: oldToken }] }
    const next = { ...page([{ ...task('mesh-42'), kind: 'read', testToken: newToken }]), testPlacements: [{ taskId: 'mesh-42', subjectId: 'math', token: newToken }] }
    const merged = mergeDayPage(old, next)
    expect(merged.testPlacements).toEqual([{ taskId: 'mesh-42', subjectId: 'math', token: newToken }])
    expect(merged.subjects[0].tasks[0].testToken).toBe(newToken)
  })
})
