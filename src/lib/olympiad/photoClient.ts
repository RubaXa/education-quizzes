import { getAuth } from 'firebase/auth'
import { olympiadEndpoint } from './client'

/** Private authenticated binary transport; neither photo bytes nor identifiers enter LDD.
 * @see ../../../docs/modules/assessments/olympiad-preparation.md#модель-урока-и-свидетельств */
export async function olympiadPhoto(action: 'photo-upload' | 'photo-read', request: Record<string, string>, bytes?: Blob): Promise<Blob | { photoId: string }> {
  const endpoint = olympiadEndpoint(), user = getAuth().currentUser
  if (!endpoint || !user) throw new Error('Сервис фотографий недоступен.')
  const url = new URL(endpoint)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/photo`
  const token = await user.getIdToken()
  const response = await fetch(url.href, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'X-Olympiad-Photo': JSON.stringify({ action, request }) }, body: bytes ?? new Blob(), cache: 'no-store' })
  if (!response.ok) throw new Error('Не удалось передать фотографию.')
  if (action === 'photo-read') return response.blob()
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object' || !('result' in payload) || !payload.result || typeof payload.result !== 'object' || !('photoId' in payload.result) || typeof payload.result.photoId !== 'string') throw new Error('Нет подтверждения фотографии.')
  return { photoId: payload.result.photoId }
}
