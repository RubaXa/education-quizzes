/** Pupil-specific school calendar. No inference from dates, seasons or absent lessons.
 * @see ../docs/modules/school-diary/school-calendar.md */
export function calendarDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
}
function plus(date, count) { const next = new Date(`${date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + count); return next.toISOString().slice(0, 10) }
function sameOwner(a, b) { return a?.familyId && a.familyId === b?.familyId && a.childId && a.childId === b?.childId }

export function normalizeMeshCalendar(capture, owner) {
  if (capture?.schemaVersion !== 1 || capture.source !== 'mesh' || !sameOwner(capture.owner, owner)
    || !owner.sourcePersonId || capture.owner.sourcePersonId !== owner.sourcePersonId
    || !calendarDate(capture.query?.from) || !calendarDate(capture.query?.to) || capture.query.from > capture.query.to
    || !Number.isFinite(Date.parse(capture.fetchedAt)) || !Array.isArray(capture.payload)) throw Error('invalid_calendar_capture')
  const rows = [...capture.payload].sort((a, b) => String(a?.date).localeCompare(String(b?.date)))
  const count = (Date.parse(`${capture.query.to}T12:00:00Z`) - Date.parse(`${capture.query.from}T12:00:00Z`)) / 86400000 + 1
  if (count > 400 || rows.length !== count) throw Error('incomplete_school_calendar')
  const vacations = []
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (!row || row.date !== plus(capture.query.from, index) || !['workday', 'holiday', 'vacation', 'other'].includes(row.type)
      || !(row.title == null || typeof row.title === 'string' && row.title.length <= 160)) throw Error('invalid_calendar_day')
    const explicitTitle = typeof row.title === 'string' && /каникул/iu.test(row.title)
    if (row.type === 'workday' && explicitTitle) throw Error('conflicting_calendar_day')
    if (row.type !== 'vacation' && !explicitTitle) continue
    const title = row.title?.trim() || 'Каникулы'
    const previous = vacations.at(-1)
    if (previous && previous.title === title && plus(previous.to, 1) === row.date) previous.to = row.date
    else vacations.push({ from: row.date, to: row.date, title })
  }
  return { schemaVersion: 1, source: 'mesh', owner: { ...owner }, from: capture.query.from, to: capture.query.to,
    checkedAt: capture.fetchedAt, vacations }
}

export function validSchoolCalendar(value) {
  if (!value || value.schemaVersion !== 1 || value.source !== 'mesh' || !calendarDate(value.from) || !calendarDate(value.to)
    || value.from > value.to || !Number.isFinite(Date.parse(value.checkedAt)) || !/^[a-f0-9]{64}$/.test(value.revision ?? '')
    || !Array.isArray(value.vacations) || value.vacations.length > 100) return false
  let end = null
  for (const item of value.vacations) {
    if (!item || !calendarDate(item.from) || !calendarDate(item.to) || item.from > item.to || item.from < value.from || item.to > value.to
      || end && item.from <= end || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160) return false
    end = item.to
  }
  return true
}
export function publicSchoolCalendar(calendar, owner) {
  if (!sameOwner(calendar?.owner, owner)) throw Error('school_calendar_owner_mismatch')
  const { schemaVersion, source, from, to, checkedAt, vacations, revision } = calendar
  const value = { schemaVersion, source, from, to, checkedAt, vacations, revision }
  if (!validSchoolCalendar(value)) throw Error('invalid_school_calendar')
  return value
}

/** Extend only the existing six-week horizon. Do not manufacture lesson completeness. */
export function applySchoolCalendar(index, calendar, today = index.today) {
  if (!validSchoolCalendar(calendar) || !calendarDate(today)) return index
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7
  const start = plus(today, -weekday), end = [plus(start, 41), calendar.to].sort()[0]
  const days = new Map(index.days.map(day => [day.date, day]))
  for (let date = start; date <= end; date = plus(date, 1)) if (date >= calendar.from && !days.has(date)) {
    days.set(date, { date, complete: false, checkedAt: null, sourceRevision: null, schedule: [], homework: [], dayToken: null, homeworkDayToken: null })
  }
  return { ...index, schoolCalendar: calendar, days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) }
}
export function vacationOn(calendar, date) {
  return validSchoolCalendar(calendar) ? calendar.vacations.find(item => item.from <= date && date <= item.to) : undefined
}
export function schoolCalendarGroups(days, calendar) {
  const groups = []
  for (const day of days) {
    const vacation = vacationOn(calendar, day.date), previous = groups.at(-1)
    if (vacation && previous?.vacation === vacation && plus(previous.days.at(-1).date, 1) === day.date) previous.days.push(day)
    else groups.push({ vacation, days: [day] })
  }
  return groups
}
