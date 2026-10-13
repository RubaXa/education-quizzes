import { describe, expect, it } from 'vitest'
import { materialGrantError } from './material-access.mjs'

const shared = { bookId: 'history-2026', sourceSha256: 'sha-2026', state: 'published', url: 'https://example.com/page.png' }
const catalog = { bookId: 'history-2026', role: 'student-textbook', sourceSha256: 'sha-2026' }
describe('доступ семьи к общим страницам', () => {
  it('не выдаёт общий учебник по одному наличию страницы или другой редакции', () => {
    expect(materialGrantError({ ref: 'history-2026#1', catalog, shared, binding: null, teacherAssigned: false })).toMatch(/нет подтверждённой связи/)
    expect(materialGrantError({ ref: 'history-2026#1', catalog, shared, binding: { status: 'confirmed', sourceSha256: 'sha-2025' }, teacherAssigned: false })).toMatch(/не совпадает/)
  })
  it('принимает собственный PDF и конкретный лист учителя', () => {
    expect(materialGrantError({ ref: 'history-2026#1', catalog, shared, binding: { status: 'provisional', sourceSha256: 'sha-2026' }, teacherAssigned: false })).toBeNull()
    expect(materialGrantError({ ref: 'teacher#1', catalog: null, shared, binding: null, teacherAssigned: true })).toBeNull()
    expect(materialGrantError({ ref: 'teacher#1', catalog: null, shared, binding: null, teacherAssigned: false })).toMatch(/не подтверждено/)
  })
})
