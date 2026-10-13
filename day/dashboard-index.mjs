import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lessonVisibility } from '../diary/application/lesson-visibility.mjs'
import { daySourceRevision } from '../sync/day-source-revision.mjs'
import { referencedHomeworkDate } from './homework-reference.mjs'

function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')) }
function dateOnly(value) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value) }
function addDays(date, count) { const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + count); return next.toISOString().slice(0, 10) }
function monday(date) { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return addDays(date, -(day === 0 ? 6 : day - 1)) }
function conciseSubject(name) { return String(name || 'Предмет').replace('Иностранный (английский) язык', 'Английский язык').replace(/.*Специальный курс по математике.*/, 'Спецкурс по математике') }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value }

/**
 * Проецирует проверенные снимки МЭШ и ссылки опубликованных дней в ролевой индекс.
 * Интерфейс читает этот документ из Firestore и не хранит расписание в коде.
 * @see ../docs/product/dashboard.md#firestore-model
 */
export function buildDayDashboardIndex(local, links, role, now = new Date()) {
  const today = dateOnly(now)
  const weekStart = monday(today)
  const snapshotDir = resolve(local, 'diary')
  const snapshots = new Map()
  if (existsSync(snapshotDir)) {
    for (const name of readdirSync(snapshotDir)) {
      const date = /^snapshot-(\d{4}-\d{2}-\d{2})\.json$/.exec(name)?.[1]
      if (!date) continue
      const snapshot = readJson(resolve(snapshotDir, name))
      if (snapshot.complete) snapshots.set(date, snapshot)
    }
  }
  const homeworkSources = new Map()
  for (const [sourceDate, pair] of Object.entries(links)) {
    const file = resolve(local, `day-source-${sourceDate}.json`)
    if (!pair?.[role] || !existsSync(file)) continue
    const targetDate = readJson(file).targetDate
    if (/^\d{4}-\d{2}-\d{2}$/.test(targetDate ?? '') && (!homeworkSources.has(targetDate) || sourceDate > homeworkSources.get(targetDate).sourceDate)) {
      homeworkSources.set(targetDate, { sourceDate, token: pair[role] })
    }
  }
  const dates = [...snapshots.keys()].sort()
  const lastScheduledDate = dates.filter((date) => {
    const snapshot = snapshots.get(date)
    return lessonVisibility(snapshot.schedule).conducted.some((item) => !item.cancelled)
      || lessonVisibility(snapshot.assignments).conducted.some((item) => !item.cancelled)
  }).at(-1)
  const weekEnd = addDays(weekStart, 6)
  const lastHomeworkDate = [...homeworkSources.keys()].sort().at(-1)
  const end = [weekEnd, lastScheduledDate, lastHomeworkDate].filter(Boolean).sort().at(-1)
  const firstSavedDate = [...dates, ...Object.keys(links), ...homeworkSources.keys()].sort()[0]
  const start = firstSavedDate && firstSavedDate < weekStart ? firstSavedDate : weekStart
  const days = []
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const snapshot = snapshots.get(date)
    const schedule = lessonVisibility(snapshot?.schedule).conducted?.filter((item) => !item.cancelled) ?? []
    const assignments = lessonVisibility(snapshot?.assignments).conducted?.filter((item) => !item.cancelled) ?? []
    const homeworkEntries = assignments.flatMap((assignment) => {
      const entries = assignment.homeworkEntries?.length
        ? assignment.homeworkEntries.map((entry) => entry.description)
        : assignment.descriptions || []
      return entries.filter((text) => typeof text === 'string' && text.trim()).map((text) => ({ subject: conciseSubject(assignment.subjectName || assignment.subject_name), text: text.trim(), referenceDate: referencedHomeworkDate(text, date) }))
    })
    const homeworkBySubject = new Map()
    for (const item of homeworkEntries) {
      const texts = homeworkBySubject.get(item.subject) ?? []
      if (!texts.includes(item.text)) texts.push(item.text)
      homeworkBySubject.set(item.subject, texts)
    }
    const homework = [...homeworkBySubject].map(([subject, texts]) => ({ subject, text: texts.join('; ') }))
    // An exact MESH pointer such as “Смотри задание на четверг” opens that
    // published lesson, instead of demanding a duplicate Friday page.
    const referencedDates = homeworkEntries.map((entry) => entry.referenceDate)
    const referencedDate = homeworkEntries.length && referencedDates.every((item) => item && item === referencedDates[0])
      ? referencedDates[0] : null
    const referencedSnapshot = referencedDate ? snapshots.get(referencedDate) : null
    const matchingSubject = referencedSnapshot && homeworkEntries.every((entry) =>
      lessonVisibility(referencedSnapshot.assignments).conducted.some((assignment) =>
        conciseSubject(assignment.subjectName || assignment.subject_name) === entry.subject
        && (assignment.homeworkEntries?.length || assignment.descriptions?.length)))
    const referencedToken = matchingSubject ? homeworkSources.get(referencedDate)?.token : null
    const lessonList = schedule.map((lesson) => ({ subject: conciseSubject(lesson.subject_name), start: lesson.start_at ?? '', end: lesson.finish_at ?? '' }))
    days.push({
      date, checkedAt: snapshot?.fetchedAt ?? null, complete: Boolean(snapshot?.complete),
      sourceRevision: snapshot?.complete ? daySourceRevision(snapshot) : null,
      schedule: lessonList, homework, dayToken: links[date]?.[role] ?? null,
      homeworkDayToken: homeworkSources.get(date)?.token ?? referencedToken ?? null,
    })
  }
  const weekendTaskOwners = new Set()
  const weekendWork = readdirSync(local).flatMap((name) => {
    const sourceDate = /^day-source-(\d{4}-\d{2}-\d{2})\.json$/.exec(name)?.[1]
    if (!sourceDate) return []
    const source = readJson(resolve(local, name))
    const slot = source.weekendSlot
    if (!slot) return []
    const pair = links[sourceDate]
    if (!pair?.[role]) throw new Error(`Выходная работа ${name} не опубликована для роли ${role}.`)
    if (!validDate(source.targetDate) || !Array.isArray(slot.dates) || !slot.dates.length
      || !slot.dates.every((date) => validDate(date) && date < source.targetDate && [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()))
      || new Set(slot.dates).size !== slot.dates.length || typeof slot.title !== 'string' || !slot.title.trim()
      || !Array.isArray(slot.taskIds) || !slot.taskIds.length || new Set(slot.taskIds).size !== slot.taskIds.length) {
      throw new Error(`У выходной работы ${name} нужны выходные даты, название и уникальные ID заданий своего урока.`)
    }
    const tasks = source.subjects?.flatMap((subject) => subject.tasks ?? []) ?? []
    const selected = slot.taskIds.map((id) => tasks.find((task) => task.id === id))
    if (selected.some((task) => !task || !task.problems?.length || (task.lessonDate ?? source.targetDate) !== source.targetDate)) {
      throw new Error(`Выходная работа ${name} ссылается на отсутствующее или перенесённое задание. Обновите её привязку до публикации.`)
    }
    const dueDates = new Set(selected.map((task) => task.dueDate || source.targetDate))
    const dueDate = [...dueDates][0]
    if (dueDates.size !== 1 || slot.dueDate && slot.dueDate !== dueDate) {
      throw new Error(`У выходной работы ${name} срок сдачи не совпадает с заданием.`)
    }
    for (const id of slot.taskIds) {
      const key = `${source.targetDate}:${id}`
      if (weekendTaskOwners.has(key)) throw new Error(`Выходное задание ${id} повторяется в нескольких карточках.`)
      weekendTaskOwners.add(key)
    }
    if (!slot.dates.some((date) => date >= start && date <= end)) return []
    return [{ dates: slot.dates, dayToken: pair[role], taskIds: slot.taskIds, lessonDate: source.targetDate,
      dueDate, title: slot.title }]
  })
  return { schemaVersion: 1, kind: role, today, timezone: 'Europe/Moscow', days, weekendWork }
}

/** An absent local source must not silently erase work already visible to the family.
 * @see ../docs/product/dashboard.md#weekend-work-contract
 */
export function assertWeekendWorkRetention(previous = [], current = [], removals = []) {
  if (!Array.isArray(removals) || removals.some((item) => !validDate(item.lessonDate)
    || !Array.isArray(item.taskIds) || !item.taskIds.length || !item.taskIds.every((id) => typeof id === 'string' && id.trim())
    || typeof item.reason !== 'string' || !item.reason.trim())) {
    throw new Error('Для снятия выходной карточки нужны дата урока, ID заданий и причина.')
  }
  const key = (item) => `${item.lessonDate}:${[...item.taskIds].sort().join(',')}`
  const active = new Set(current.map(key))
  const authorized = new Set(removals.map(key))
  for (const item of previous) {
    if (!active.has(key(item)) && !authorized.has(key(item))) {
      throw new Error(`Ранее опубликованная выходная работа ${item.lessonDate} исчезла из локального плана. Восстановите weekendSlot или явно оформите снятие.`)
    }
  }
}
