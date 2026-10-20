/** Narrow date-row update for an explicitly published family task.
 * Other dashboard dates and top-level projections are preserved byte-for-byte.
 * @see ../docs/modules/school-diary/dashboard.md#firestore-model
 * @see ../docs/decisions/family-essay-assignment-2026-10-20.md */

import { isDeepStrictEqual } from 'node:util'

export function familyDashboardDateDelta(previous, expectedDay, { familyId, childId, role, changedSubject, at } = {}) {
  if (!previous || previous.schemaVersion !== 1 || previous.familyId !== familyId || previous.childId !== childId || previous.kind !== role) {
    throw new Error('Существующий dashboard не совпадает с подтверждённым владельцем и ролью.')
  }
  if (!expectedDay || typeof expectedDay.date !== 'string' || !Array.isArray(expectedDay.homework)) throw new Error('Нет проверенной строки срока семейного задания.')
  if (!Array.isArray(previous.days)) throw new Error('В существующем dashboard нет списка дат для адресного исправления.')
  const indexes = previous.days.flatMap((day, index) => day.date === expectedDay.date ? [index] : [])
  if (indexes.length !== 1) throw new Error(`Для адресного обновления нужна ровно одна строка ${expectedDay.date}.`)
  const index = indexes[0]
  const oldDay = previous.days[index]
  const nextHomeworkDayToken = expectedDay.homeworkDayToken ?? null
  const sameHomework = isDeepStrictEqual(oldDay.homework ?? [], expectedDay.homework)
  const sameToken = (oldDay.homeworkDayToken ?? null) === nextHomeworkDayToken
  if (sameHomework && sameToken) return null
  const days = previous.days.slice()
  const nextDay = { ...oldDay, homework: expectedDay.homework, homeworkDayToken: nextHomeworkDayToken }
  if (changedSubject && at) nextDay.homeworkUpdate = { at, subjects: [changedSubject] }
  days[index] = nextDay
  return { ...previous, days }
}
