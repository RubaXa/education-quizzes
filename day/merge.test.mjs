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
})
