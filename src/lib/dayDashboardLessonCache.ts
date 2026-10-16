import type { LessonWorkItem } from './homeworkStatus'

/** A small, role-scoped view projection for the first frame of a reopened day.
 * It is written only after every input to the status calculation has answered.
 * @see ../../docs/modules/school-diary/dashboard.md#dashboard-warm-start */
export type CachedLessonStatus = {
  key: string
  tone: 'checking' | 'unclear' | 'complete' | 'partial' | 'empty' | 'reference' | 'assigned' | 'none' | 'optional' | 'unknown'
  badge: string
  items: LessonWorkItem[]
  referenceDate?: string
  referenceText?: string
}

const tones = new Set<CachedLessonStatus['tone']>(['checking', 'unclear', 'complete', 'partial', 'empty', 'reference', 'assigned', 'none', 'optional', 'unknown'])
function key(token: string, role: 'parent' | 'student', date: string) {
  return `education-day-dashboard-lesson-v1:${role}:${token}:${date}`
}
export function lessonCacheKey(start: string, subject: string) { return `${start}|${subject}` }

export function readCachedLessonStatuses(token: string, role: 'parent' | 'student', date: string): CachedLessonStatus[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(token, role, date)) ?? 'null')
    if (!value || typeof value !== 'object') return []
    const record = value as { version?: unknown; lessons?: unknown }
    if (record.version !== 1 || !Array.isArray(record.lessons) || record.lessons.length > 32) return []
    return record.lessons.every((item): item is CachedLessonStatus => {
      if (!item || typeof item !== 'object') return false
      const row = item as CachedLessonStatus
      return typeof row.key === 'string' && row.key.length <= 240 && typeof row.badge === 'string' && row.badge.length <= 80
        && tones.has(row.tone) && Array.isArray(row.items) && row.items.length <= 100
        && row.items.every((work) => work && typeof work.id === 'string' && typeof work.title === 'string'
          && typeof work.detail === 'string' && ['done', 'todo', 'checking', 'unclear'].includes(work.state))
        && (row.referenceDate === undefined || typeof row.referenceDate === 'string')
        && (row.referenceText === undefined || typeof row.referenceText === 'string')
    }) ? record.lessons : []
  } catch { return [] }
}

export function writeCachedLessonStatuses(token: string, role: 'parent' | 'student', date: string, lessons: CachedLessonStatus[]) {
  try { localStorage.setItem(key(token, role, date), JSON.stringify({ version: 1, lessons })) } catch { /* Live page remains usable. */ }
}

export function clearCachedLessonStatuses(token: string, role: 'parent' | 'student') {
  try {
    const prefix = `education-day-dashboard-lesson-v1:${role}:${token}:`
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const candidate = localStorage.key(index)
      if (candidate?.startsWith(prefix)) localStorage.removeItem(candidate)
    }
  } catch { /* Access checks on the live route remain authoritative. */ }
}
