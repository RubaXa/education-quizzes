import { describe, expect, it } from 'vitest'
import { ownerMigrationFields } from './owner-repair.mjs'

const page = { date: '2026-10-09', targetDate: '2026-10-12', subjects: [{ tasks: [{ id: 'mesh-1' }] }] }
const owner = { date: '2026-10-09', targetDate: '2026-10-12', familyId: 'family', childId: 'child' }
describe('миграция владельца старой страницы', () => {
  it('добавляет только подтверждённые поля владельца', () => {
    expect(ownerMigrationFields(page, owner)).toEqual({ familyId: 'family', childId: 'child' })
    expect(page).not.toHaveProperty('familyId')
  })
  it('запрещает перенос на другой день или семью', () => {
    expect(() => ownerMigrationFields(page, { ...owner, targetDate: '2026-10-13' })).toThrow(/не подтверждает/)
    expect(() => ownerMigrationFields({ ...page, familyId: 'other' }, owner)).toThrow(/другой владелец/)
  })
})
