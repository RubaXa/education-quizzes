/** Device-local acknowledgement of an already opened lesson update.
 * A new source timestamp gets a new key; no Firestore read or write is needed.
 * @see ../../docs/modules/school-diary/dashboard.md#homework-updates
 */
export function homeworkUpdateKey(dashboardToken: string, date: string, subject: string, updatedAt: string): string {
  return `education-homework-update:${encodeURIComponent(dashboardToken)}:${date}:${encodeURIComponent(subject.trim().toLocaleLowerCase('ru-RU'))}:${encodeURIComponent(updatedAt)}`
}

export function wasHomeworkUpdateSeen(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}

export function markHomeworkUpdateSeen(key: string): void {
  try { localStorage.setItem(key, '1') } catch { /* The current view still acknowledges it. */ }
}
