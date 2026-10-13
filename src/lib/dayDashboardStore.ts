import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import { normalizeDayDashboard } from './dayCompatibility'

export type IndexedHomework = { subject: string; text: string }
export type IndexedLesson = { subject: string; start: string; end: string }
export type IndexedDay = {
  date: string
  checkedAt: string | null
  complete: boolean
  schedule: IndexedLesson[]
  homework: IndexedHomework[]
  homeworkUpdate?: { at: string; subjects: string[] }
  dayToken: string | null
  homeworkDayToken?: string | null
}
export type DayDashboardData = {
  schemaVersion: number
  kind: 'student' | 'parent'
  today: string
  timezone: string
  days: IndexedDay[]
  weekendWork?: { dates: string[]; dayToken: string; taskIds: string[]; lessonDate: string; dueDate: string; title: string }[]
  updatedAt?: unknown
}

function localKey(token: string) { return `education-day-dashboard-v1:${token}` }

export function clearCachedDayDashboard(token: string) {
  try { localStorage.removeItem(localKey(token)) } catch { /* The live access check remains authoritative. */ }
}

/** Last published calendar for immediate role-specific rendering on reopen. */
export function readCachedDayDashboard(token: string, kind: DayDashboardData['kind']): DayDashboardData | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(localKey(token)) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const data = normalizeDayDashboard(value as Record<string, unknown>)
    return data.kind === kind ? data : null
  } catch { return null }
}

/** @see ../../docs/product/dashboard.md#firestore-model */
export function watchDayDashboard(token: string, onChange: (data: DayDashboardData) => void, onError: (error: Error) => void) {
  const hadCompleteLocalView = Boolean(readCachedDayDashboard(token, 'parent') || readCachedDayDashboard(token, 'student'))
  return onSnapshot(doc(db, 'dayDashboards', token), { includeMetadataChanges: true }, (snapshot) => {
    // The SDK's disk cache can lag behind the projection shown at the end of
    // the previous session. Wait for the server before replacing that view.
    if (hadCompleteLocalView && snapshot.metadata?.fromCache) return
    if (!snapshot.exists()) { onError(new Error('Dashboard по этой ссылке не найден.')); return }
    try {
      const data = normalizeDayDashboard(snapshot.data())
      try { localStorage.setItem(localKey(token), JSON.stringify(data)) } catch { /* Live view still works. */ }
      onChange(data)
    } catch (error) { onError(error as Error) }
  }, onError)
}
