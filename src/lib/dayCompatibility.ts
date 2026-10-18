import type { DayPageData, DayTask, DayTestPlacement } from './dayStore'
import type { DayDashboardData } from './dayDashboardStore'
import { validSchoolCalendar } from '../../day/school-calendar.mjs'

export const DATA_UPDATE_MESSAGE = 'Версия данных несовместима с этим приложением. Обновите Education.'

export class UnsupportedDataSchemaError extends Error {
  readonly code = 'unsupported-data-schema'
  constructor(surface: string, version: unknown) {
    super(`${DATA_UPDATE_MESSAGE} Раздел: ${surface}; версия: ${String(version ?? 'не указана')}.`)
  }
}

function supportedVersion(value: unknown) { return value == null || value === 0 || value === 1 }
function bareToken(value: string) { return value.includes('~') ? value.slice(value.lastIndexOf('~') + 1) : value }

/** Migrate the readable v0/v1 page shape in memory. Never write from the browser.
 * An old placement is superseded by the task's current testToken.
 * @see ../../docs/modules/families/access-and-state.md#schema-compatibility */
export function normalizeDayPage(raw: unknown): DayPageData {
  const data = raw as DayPageData & { schemaVersion?: number }
  if (!data || typeof data !== 'object' || !supportedVersion(data.schemaVersion)
    || !['student', 'parent'].includes(data.kind) || typeof data.date !== 'string'
    || typeof data.targetDate !== 'string' || !Array.isArray(data.subjects)
    || !data.subjects.every((subject) => subject && Array.isArray(subject.tasks))) {
    throw new UnsupportedDataSchemaError('страница дня', data?.schemaVersion)
  }
  const subjects = data.subjects.map((subject) => ({ ...subject, tasks: subject.tasks.map((task): DayTask =>
    task.testToken ? { ...task, testToken: bareToken(task.testToken) } : task) }))
  const tasks = new Map(subjects.flatMap((subject) => subject.tasks.map((task) => [task.id, task] as const)))
  const placements = new Map<string, DayTestPlacement>()
  for (const item of data.testPlacements ?? []) {
    if (!item || typeof item.token !== 'string') continue
    const token = bareToken(item.token)
    if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) continue
    if (item.taskId) {
      const task = tasks.get(item.taskId)
      if (!task || task.testToken && task.testToken !== token) continue
      placements.set(`task:${item.taskId}`, { ...item, token })
    } else placements.set(`standalone:${token}`, { ...item, token })
  }
  return { ...data, subjects, testPlacements: [...placements.values()] }
}

/** The calendar index has only additive v1 fields. Missing version is the readable legacy shape. */
export function normalizeDayDashboard(raw: unknown): DayDashboardData {
  const data = raw as DayDashboardData & { schemaVersion?: number }
  if (!data || typeof data !== 'object' || !supportedVersion(data.schemaVersion)
    || !['student', 'parent'].includes(data.kind) || !Array.isArray(data.days)) {
    throw new UnsupportedDataSchemaError('календарь', data?.schemaVersion)
  }
  const { schoolCalendar, ...base } = data
  return { ...base, schemaVersion: 1, weekendWork: data.weekendWork ?? [], ...(validSchoolCalendar(schoolCalendar) ? { schoolCalendar } : {}) }
}
