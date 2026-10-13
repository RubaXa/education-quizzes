import type { DayPageData } from './dayStore'
import type { LessonWorkItem } from './homeworkStatus'

/** Last complete visible projections for a reopened calendar route.
 * Keys include the role and published document token; a new document never
 * inherits a different role's work or grades.
 * @see ../../docs/product/dashboard.md#dashboard-warm-start */
export type CachedHomeworkRow = {
  subject: { id: string; name: string; icon: string; tasks: { title: string }[] }
  items: LessonWorkItem[]
  done: number
  group: 'action' | 'waiting' | 'complete'
}
export type CachedGrades = Pick<DayPageData, 'gradeSummary' | 'grades' | 'gradeAsOf'>

type Role = 'parent' | 'student'
function prefix(role: Role, dashboardToken: string) { return `education-day-dashboard-view-v1:${role}:${dashboardToken}:` }
function key(role: Role, dashboardToken: string, type: 'work' | 'grades', documentToken: string) {
  return `${prefix(role, dashboardToken)}${type}:${documentToken}`
}
function read(value: string | null): unknown {
  try { const parsed = JSON.parse(value ?? 'null'); return parsed?.version === 1 ? parsed.data : null }
  catch { return null }
}

export function readCachedHomeworkRows(role: Role, dashboardToken: string, dayToken: string): CachedHomeworkRow[] {
  try {
    const rows = read(localStorage.getItem(key(role, dashboardToken, 'work', dayToken)))
    if (!Array.isArray(rows) || rows.length > 32) return []
    return rows.every((row): row is CachedHomeworkRow => row && typeof row === 'object'
      && row.subject && typeof row.subject.id === 'string' && typeof row.subject.name === 'string'
      && typeof row.subject.icon === 'string' && Array.isArray(row.subject.tasks)
      && row.subject.tasks.every((task: { title?: unknown }) => typeof task.title === 'string')
      && Array.isArray(row.items) && row.items.length <= 100
      && row.items.every((item: LessonWorkItem) => item && typeof item.id === 'string' &&
        typeof item.title === 'string' && typeof item.detail === 'string' &&
        ['done', 'todo', 'checking', 'unclear'].includes(item.state))
      && Number.isSafeInteger(row.done) && row.done >= 0 && row.done <= row.items.length
      && ['action', 'waiting', 'complete'].includes(row.group)) ? rows : []
  } catch { return [] }
}
export function writeCachedHomeworkRows(role: Role, dashboardToken: string, dayToken: string, rows: CachedHomeworkRow[]) {
  try { localStorage.setItem(key(role, dashboardToken, 'work', dayToken), JSON.stringify({ version: 1, data: rows })) }
  catch { /* Live work stays available when durable storage is full or disabled. */ }
}
export function readCachedGrades(role: Role, dashboardToken: string, dayToken: string): CachedGrades | null {
  try {
    const data = read(localStorage.getItem(key(role, dashboardToken, 'grades', dayToken))) as CachedGrades | null
    if (!data || !Array.isArray(data.gradeSummary) || data.gradeSummary.length > 40 ||
      !data.gradeSummary.every((grade) => typeof grade.id === 'string' && typeof grade.name === 'string' && Number.isFinite(grade.average)) ||
      (data.grades !== undefined && !Array.isArray(data.grades))) return null
    return data
  } catch { return null }
}
export function writeCachedGrades(role: Role, dashboardToken: string, dayToken: string, page: DayPageData) {
  try { localStorage.setItem(key(role, dashboardToken, 'grades', dayToken), JSON.stringify({ version: 1,
    data: { gradeSummary: page.gradeSummary, grades: page.grades, gradeAsOf: page.gradeAsOf } })) }
  catch { /* Live grades stay available. */ }
}
export function clearCachedDashboardView(role: Role, dashboardToken: string) {
  try {
    const scope = prefix(role, dashboardToken)
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const candidate = localStorage.key(index)
      if (candidate?.startsWith(scope)) localStorage.removeItem(candidate)
    }
  } catch { /* The remote access check remains authoritative. */ }
}
