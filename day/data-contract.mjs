/**
 * @see ../docs/shared/data/README.md
 */
/** @see ../docs/modules/materials/material-clarification.md */
import { materialRequestErrors } from '../src/lib/materialRequest.ts'
/** Runtime shape of the current Firestore projection. Optional additive fields are
 * accepted so older clients and already published documents keep working.
 * Cross-document edges are checked by placement-integrity.mjs.
 * @see ../docs/shared/data/firestore.md#v1 */
export const DAY_SCHEMA_VERSION = 1
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value) => typeof value === 'string' && value.trim().length > 0
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const roles = new Set(['student', 'parent'])

export function dayPageShapeErrors(page) {
  const errors = []
  if (!object(page)) return ['Страница дня должна быть документом.']
  if (page.schemaVersion !== DAY_SCHEMA_VERSION) errors.push('Неизвестная версия страницы дня.')
  if (!roles.has(page.kind)) errors.push('Неизвестная роль страницы дня.')
  if (!date(page.date) || !date(page.targetDate)) errors.push('Неверные даты страницы дня.')
  if (!text(page.boardToken)) errors.push('У страницы дня отсутствует список тестов роли.')
  if (Boolean(page.familyId) !== Boolean(page.childId)) errors.push('Семья и ребёнок должны задаваться вместе.')
  if (Object.values(page.taskPageRefs ?? {}).some((refs) => Array.isArray(refs) && refs.length)
    && (!page.familyId || !page.childId)) errors.push('Страница с материалами не имеет семейного владельца.')
  if (page.kind === 'parent' && !text(page.studentToken)) errors.push('Родительская страница не связана со страницей ученика.')
  if (!Array.isArray(page.subjects)) errors.push('Предметы должны быть массивом.')
  else for (const subject of page.subjects) {
    if (!object(subject) || !text(subject.id) || !Array.isArray(subject.tasks)) { errors.push('У предмета нет ID или массива заданий.'); continue }
    for (const task of subject.tasks) {
      if (!object(task) || !text(task.id) || !text(task.title)) { errors.push('У задания нет ID или названия.'); continue }
      errors.push(...materialRequestErrors(task))
      if (!['written', 'read', 'check'].includes(task.kind)) errors.push(`Неизвестный вид задания ${task.id}.`)
      if (!['verified', 'needs-fix', 'partial', 'unknown'].includes(task.status)) errors.push(`Неизвестный статус задания ${task.id}.`)
    }
  }
  if (page.testPlacements != null && !Array.isArray(page.testPlacements)) errors.push('Связи тестов должны быть массивом.')
  if (page.materialLinks != null && !object(page.materialLinks)) errors.push('Ссылки материалов должны быть словарём по taskId.')
  if (page.taskPageRefs != null && !object(page.taskPageRefs)) errors.push('Страницы учебников должны быть словарём по taskId.')
  if (page.evidenceDayTokens != null && !Array.isArray(page.evidenceDayTokens)) errors.push('Предыдущие дни должны быть массивом ссылок.')
  if (page.practiceVariantIds != null && (!Array.isArray(page.practiceVariantIds)
    || page.practiceVariantIds.some((id) => !text(id)))) errors.push('Варианты семейной подготовки должны иметь устойчивые ID.')
  if (page.subjects?.some((subject) => subject.tasks?.some((task) => task.parentGuide || task.sourceResearch
    || task.problems?.some((problem) => problem.parentGuide || problem.sourceResearch)))) {
    errors.push('Закрытый родительский разбор оказался в открытой странице дня.')
  }
  return errors
}

export function dayDashboardShapeErrors(index) {
  const errors = []
  if (!object(index)) return ['Календарь должен быть документом.']
  if (index.schemaVersion !== DAY_SCHEMA_VERSION) errors.push('Неизвестная версия календаря.')
  if (!roles.has(index.kind)) errors.push('Неизвестная роль календаря.')
  if (!text(index.timezone)) errors.push('У календаря нет часового пояса.')
  if (!Array.isArray(index.days)) return [...errors, 'Дни календаря должны быть массивом.']
  const seen = new Set()
  for (const day of index.days) {
    if (!object(day) || !date(day.date) || !Array.isArray(day.schedule) || !Array.isArray(day.homework)) {
      errors.push('Неверная форма дня календаря.'); continue
    }
    if (seen.has(day.date)) errors.push(`Дата ${day.date} повторяется в календаре.`)
    seen.add(day.date)
    for (const key of ['dayToken', 'homeworkDayToken']) if (day[key] != null && !text(day[key])) errors.push(`Неверная ссылка ${key} на ${day.date}.`)
  }
  return errors
}

export function assignmentShapeErrors(assignment) {
  const errors = []
  if (!object(assignment)) return ['Тест должен быть документом.']
  // Pre-v1 assignments remain readable; new releases always write version 1.
  if (assignment.schemaVersion != null && assignment.schemaVersion !== 1) errors.push('Неизвестная версия теста.')
  if (!text(assignment.testId) || !text(assignment.title) || !text(assignment.subject)) errors.push('У теста нет ID, названия или предмета.')
  if (!['open', 'submitted'].includes(assignment.status)) errors.push('Неизвестный статус теста.')
  if (!Array.isArray(assignment.questions)) return [...errors, 'Вопросы теста должны быть массивом.']
  const seen = new Set()
  for (const question of assignment.questions) {
    if (!object(question) || !text(question.id) || !text(question.prompt)) { errors.push('У вопроса нет ID или текста.'); continue }
    if (seen.has(question.id)) errors.push(`Вопрос ${question.id} повторяется.`)
    seen.add(question.id)
  }
  return errors
}
