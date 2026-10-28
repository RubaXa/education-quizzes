import { getAuth } from 'firebase/auth'

/** Server is the authority for role, child scope and closed answer keys.
 * @see ../../../docs/modules/assessments/olympiad-preparation.md#реализация-и-проверки */
export type OlympiadCatalogItem = { id: string; title: string; deadline?: string | null; participationEnabled: boolean; practiceAvailable?: boolean; subject?: string; schedule?: string; eligibility?: 'eligible' | 'unknown'; sources?: { title: string; url: string }[]; lessons: { id: string; version: string; title: string; topicId: string }[] }
export type OlympiadAttempt = { attemptId: string; lessonId: string; lessonVersion: string; status: 'active' | 'completed' }
export type OlympiadScope = { familyId: string; childId: string; olympiadId: string; attemptId: string }
export function olympiadEndpoint(): string | null {
  const value: unknown = import.meta.env.VITE_OLYMPIAD_API_URL
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value, window.location.origin)
    if (url.username || url.password || url.hash || url.search) return null
    const localDev = import.meta.env.DEV && url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !localDev) return null
    return url.href
  } catch { return null }
}
export async function olympiadRequest<T>(body: Record<string, unknown>): Promise<T> {
  const endpoint = olympiadEndpoint()
  const user = getAuth().currentUser
  if (!endpoint || !user) throw new Error('Сервис подготовки недоступен.')
  const token = await user.getIdToken()
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
  if (!response.ok) throw new Error('Не удалось получить данные подготовки.')
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object' || !('result' in payload)) throw new Error('Ответ сервиса подготовки недоступен.')
  return payload.result as T
}
