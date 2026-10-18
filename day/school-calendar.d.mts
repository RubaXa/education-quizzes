/** @see ../docs/modules/school-diary/school-calendar.md */
export type Vacation = { from: string; to: string; title: string }
export type SchoolCalendar = { schemaVersion: 1; source: 'mesh'; from: string; to: string; checkedAt: string; revision: string; vacations: Vacation[] }
export function validSchoolCalendar(value: unknown): value is SchoolCalendar
export function vacationOn(calendar: unknown, date: string): Vacation | undefined
export function schoolCalendarGroups<T extends { date: string }>(days: T[], calendar: unknown): { vacation?: Vacation; days: T[] }[]
