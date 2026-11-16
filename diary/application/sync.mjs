import { join } from 'node:path'
import { readJson, writeJson } from '../local-store.mjs'
import { diffSnapshots } from './diff.mjs'

/** @see ../../docs/modules/school-diary/README.md#sync */
/** @see ../../docs/modules/synchronization/change-detection-and-reconciliation.md */
export async function syncDiary({ adapter, dataDir, date }) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Дата должна иметь вид YYYY-MM-DD')
  }
  const previous = readJson(dataDir, `snapshot-${date}.json`)
  const result = { schemaVersion: 1, source: 'mesh', date, fetchedAt: new Date().toISOString(), marksScope: 'subject-period-full', assignmentScope: 'schedule-lessons-on-date', profile: null, schedule: null, marks: null, assignments: null, errors: {} }
  for (const [key, load] of [
    ['profile', () => adapter.getProfile()],
    ['schedule', () => adapter.getSchedule(date)],
    ['marks', () => adapter.getMarks()],
    ['assignments', () => adapter.getAssignments(date, previous?.assignments ?? [])],
    ...(typeof adapter.getMarkFeed === 'function' ? [['recentMarks', async () => {
      const raw = await adapter.getMarkFeed(), marks = raw?.payload ?? raw
      if (!Array.isArray(marks)) throw new Error('INVALID_MARK_FEED')
      return marks
    }]] : []),
  ]) {
    try { result[key] = await load() }
    catch (error) {
      result.errors[key] = classifyError(error)
      if (key === 'assignments' && Array.isArray(error?.partialResult)) {
        result.assignments = error.partialResult
        result.incompleteDetails = error.incompleteDetails
      }
    }
  }
  if (Array.isArray(result.recentMarks) && Array.isArray(result.marks)) {
    result.markFeedScope = 'recent-not-date-filtered'
    result.marks = result.marks.map(subject => ({ ...subject, recentMarks: result.recentMarks.filter(mark =>
      mark.subject_id != null && subject.subject_id != null && String(mark.subject_id) === String(subject.subject_id) || Boolean(mark.subject_name) && mark.subject_name === subject.subject_name) }))
  }
  if (!result.profile || typeof result.profile !== 'object' || Array.isArray(result.profile)) result.errors.profile ??= 'INVALID_SHAPE'
  for (const key of ['schedule', 'marks', 'assignments']) {
    if (!Array.isArray(result[key])) result.errors[key] ??= 'INVALID_SHAPE'
  }
  if (Array.isArray(result.assignments) && result.assignments.some((item) => item.detailStatus !== 'loaded')) {
    result.errors.assignments ??= 'INCOMPLETE_DETAIL'
  }
  result.complete = Object.keys(result.errors).length === 0
  result.changesSincePrevious = diffSnapshots(previous, result)
  if (result.complete) {
    if (previous) writeJson(join(dataDir, 'history'), `snapshot-${date}-${previous.fetchedAt.replaceAll(':', '-')}.json`, previous)
    writeJson(dataDir, `snapshot-${date}.json`, result)
  } else {
    writeJson(join(dataDir, 'attempts'), `snapshot-${date}-${result.fetchedAt.replaceAll(':', '-')}.json`, result)
  }
  return result
}

function classifyError(error) {
  if (error?.code === 'INCOMPLETE_DETAIL') return 'INCOMPLETE_DETAIL'
  const message = String(error?.message || '')
  if (/API 401|API 403|авторизац/i.test(message)) return 'AUTH_REQUIRED'
  if (/API 429/.test(message)) return 'RATE_LIMITED'
  return 'TEMPORARY_FAILURE'
}
