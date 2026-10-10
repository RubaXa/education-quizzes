import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lessonVisibility } from '../diary/application/lesson-visibility.mjs'

function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')) }
function dateOnly(value) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value) }
function addDays(date, count) { const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + count); return next.toISOString().slice(0, 10) }
function monday(date) { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return addDays(date, -(day === 0 ? 6 : day - 1)) }
function conciseSubject(name) { return String(name || 'Предмет').replace('Иностранный (английский) язык', 'Английский язык').replace(/.*Специальный курс по математике.*/, 'Спецкурс по математике') }

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
      if (!date || date < weekStart) continue
      const snapshot = readJson(resolve(snapshotDir, name))
      if (snapshot.complete) snapshots.set(date, snapshot)
    }
  }
  const dates = [...snapshots.keys()].sort()
  const lastScheduledDate = dates.filter((date) => {
    const snapshot = snapshots.get(date)
    return lessonVisibility(snapshot.schedule).conducted.some((item) => !item.cancelled)
      || lessonVisibility(snapshot.assignments).conducted.some((item) => !item.cancelled)
  }).at(-1)
  const weekEnd = addDays(weekStart, 6)
  const end = lastScheduledDate && lastScheduledDate > weekEnd ? lastScheduledDate : weekEnd
  const days = []
  for (let date = weekStart; date <= end; date = addDays(date, 1)) {
    const snapshot = snapshots.get(date)
    const schedule = lessonVisibility(snapshot?.schedule).conducted?.filter((item) => !item.cancelled) ?? []
    const assignments = lessonVisibility(snapshot?.assignments).conducted?.filter((item) => !item.cancelled) ?? []
    const homeworkEntries = assignments.flatMap((assignment) => {
      const entries = assignment.homeworkEntries?.length
        ? assignment.homeworkEntries.map((entry) => entry.description)
        : assignment.descriptions || []
      return entries.filter((text) => typeof text === 'string' && text.trim()).map((text) => ({ subject: conciseSubject(assignment.subjectName || assignment.subject_name), text: text.trim() }))
    })
    const homeworkBySubject = new Map()
    for (const item of homeworkEntries) {
      const texts = homeworkBySubject.get(item.subject) ?? []
      if (!texts.includes(item.text)) texts.push(item.text)
      homeworkBySubject.set(item.subject, texts)
    }
    const homework = [...homeworkBySubject].map(([subject, texts]) => ({ subject, text: texts.join('; ') }))
    const lessonList = schedule.map((lesson) => ({ subject: conciseSubject(lesson.subject_name), start: lesson.start_at ?? '', end: lesson.finish_at ?? '' }))
    days.push({
      date, checkedAt: snapshot?.fetchedAt ?? null, complete: Boolean(snapshot?.complete),
      schedule: lessonList, homework, dayToken: links[date]?.[role] ?? null,
    })
  }
  const weekendWork = Object.entries(links).flatMap(([sourceDate, pair]) => {
    const file = resolve(local, `day-source-${sourceDate}.json`)
    if (!existsSync(file) || !pair?.[role]) return []
    const source = readJson(file)
    const dates = source.weekendSlot?.dates
    if (!Array.isArray(dates) || !dates.some((date) => date >= weekStart && date <= end)) return []
    return [{ dates, dayToken: pair[role], dueDate: source.targetDate, title: source.weekendSlot.title || 'Математика на выходных' }]
  })
  return { schemaVersion: 1, kind: role, today, timezone: 'Europe/Moscow', days, weekendWork }
}
