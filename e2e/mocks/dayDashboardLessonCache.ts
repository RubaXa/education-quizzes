/** @see ../../docs/modules/school-diary/school-calendar.md#представление */
export function clearCachedLessonStatuses() {}
export function lessonCacheKey(start: string, subject: string) { return `${start}:${subject}` }
export function readCachedLessonStatuses() { return [] }
export function writeCachedLessonStatuses() {}
