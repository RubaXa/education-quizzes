import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'

export type IndexedHomework = { subject: string; text: string }
export type IndexedLesson = { subject: string; start: string; end: string }
export type IndexedDay = {
  date: string
  checkedAt: string | null
  complete: boolean
  schedule: IndexedLesson[]
  homework: IndexedHomework[]
  dayToken: string | null
}
export type DayDashboardData = {
  schemaVersion: number
  kind: 'student' | 'parent'
  today: string
  timezone: string
  days: IndexedDay[]
  weekendWork?: { dates: string[]; dayToken: string; dueDate: string; title: string }[]
  updatedAt?: unknown
}

/** @see ../../docs/product/dashboard.md#firestore-model */
export function watchDayDashboard(token: string, onChange: (data: DayDashboardData) => void, onError: (error: Error) => void) {
  return onSnapshot(doc(db, 'dayDashboards', token), (snapshot) => {
    if (!snapshot.exists()) { onError(new Error('Dashboard по этой ссылке не найден.')); return }
    if (snapshot.data().schemaVersion !== 1) { onError(new Error('Данные dashboard обновились. Обновите приложение до новой версии.')); return }
    onChange(snapshot.data() as DayDashboardData)
  }, onError)
}
