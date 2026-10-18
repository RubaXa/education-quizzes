/** Pupil-scoped MESH source; empty schedules never imply vacations.
 * @see ../docs/modules/school-diary/school-calendar.md */
import { createHash } from 'node:crypto'
import { normalizeMeshCalendar } from '../day/school-calendar.mjs'
export function schoolYearWindow(today) {
  if (!validDate(today)) throw new Error('invalid_calendar_date')
  const year = Number(today.slice(0, 4)) - (today.slice(5, 7) < '09' ? 1 : 0)
  return { from: `${year}-09-01`, to: `${year + 1}-08-31` }
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
}
export async function captureSchoolCalendar(adapter, today, now = () => new Date().toISOString(), onFailure = () => {}) {
  const query = schoolYearWindow(today)
  let payload
  try { payload = await adapter.getSchoolCalendar(query.from, query.to) }
  catch (error) {
    // The SDK separates the response body from its credential-bearing request URL.
    // Keep source evidence privately; never print arbitrary response/exception text.
    const message = String(error?.message ?? ''), separator = message.indexOf('\n')
    onFailure({ source: 'mesh', query, fetchedAt: now(), diagnostic: calendarFailure(error),
      responseBody: separator >= 0 ? message.slice(separator + 1) : null })
    throw error
  }
  if (!payload || typeof payload !== 'object') throw new Error('invalid_calendar_payload')
  return { schemaVersion: 1, source: 'mesh', endpoint: 'family/mobile/v1/periods_schedules', query, fetchedAt: now(), payload }
}
export function calendarFailure(error) {
  const message = String(error?.message ?? '')
  const status = /\bAPI (\d{3})\b/.exec(message)?.[1]
  const body = message.slice(message.indexOf('\n') + 1)
  const parameterHints = ['begin_date', 'end_date', 'from_date', 'to_date', 'student_id', 'profile_id', 'school_year_id', 'academic_year_id', 'class_unit_id']
    .filter(parameter => body.includes(parameter))
  const schemaCodes = ['invalid_calendar_capture', 'incomplete_school_calendar', 'invalid_calendar_day', 'conflicting_calendar_day',
    'school_calendar_owner_mismatch', 'calendar_dashboards_required', 'school_calendar_readback_failed']
  return { operation: 'captureSchoolCalendar', ...(status ? { httpStatus: Number(status) } : {}),
    ...(parameterHints.length ? { parameterHints } : {}),
    code: schemaCodes.includes(message) ? message.replaceAll('_', '-') : message === 'invalid_calendar_payload' ? 'invalid-calendar-payload'
      : /не JSON/.test(message) ? 'non-json-response' : status ? 'mesh-http-error' : 'source-error' }
}
/** Safe structural summary for discovery: no profile, names, URLs or credentials. */
export function calendarShape(payload) {
  if (Array.isArray(payload)) return { type: 'array', count: payload.length,
    itemKeys: [...new Set(payload.flatMap(item => item && typeof item === 'object' ? Object.keys(item) : []))].filter(key => /^[a-z_]{1,60}$/i.test(key)).sort() }
  return { type: 'object', fields: Object.entries(payload ?? {}).filter(([key]) => /^[a-z_]{1,60}$/i.test(key))
    .map(([key, value]) => ({ key, type: Array.isArray(value) ? 'array' : typeof value, ...(Array.isArray(value) ? { count: value.length } : {}) })) }
}
export function normalizeSchoolCalendar(capture, owner) {
  const calendar = normalizeMeshCalendar(capture, owner)
  const revision = createHash('sha256').update(JSON.stringify({ owner, from: calendar.from, to: calendar.to, vacations: calendar.vacations })).digest('hex')
  return { ...calendar, revision }
}
