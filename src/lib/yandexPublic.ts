import { fetchWithRetry } from './networkRetry'

type PublicResource = { preview?: string; file?: string }

const resources = new Map<string, Promise<PublicResource>>()

/** Resolve on user intent and on every retry; signed links are never persisted.
 * @see ../../docs/modules/materials/audio-library.md#player */
export async function publicAudio(value: string, expectedSha256?: string) {
  const endpoint = new URL('https://cloud-api.yandex.net/v1/disk/public/resources/download')
  endpoint.searchParams.set('public_key', publicDiskUrl(value))
  const response = await fetchWithRetry(endpoint, { cache: 'no-store' }, { attempts: 2, timeoutMs: 7_000 })
  if (!response.ok) throw new Error(`Яндекс.Диск: ${response.status}`)
  const result = await response.json() as { href?: string }
  const url = new URL(result.href ?? '')
  if (url.protocol !== 'https:' || !/(^|\.)(yandex\.(net|ru)|yandexcloud\.net)$/.test(url.hostname)) throw new Error('Диск не вернул аудиозапись.')
  // Some browser media loaders reject Disk's attachment response. Fetch the
  // original only on intent and play a bounded, verified in-memory object.
  const content = await fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(45_000) })
  const limit = 30 * 1024 * 1024
  if (!content.ok || !content.body || Number(content.headers.get('content-length')) > limit) throw new Error('Не удалось получить аудиозапись с Диска.')
  const reader = content.body.getReader()
  const parts: Uint8Array<ArrayBuffer>[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      length += chunk.byteLength
      if (length > limit) throw new Error('Аудиозапись превышает 30 МБ.')
      parts.push(new Uint8Array(chunk))
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  const blob = new Blob(parts, { type: 'audio/mpeg' })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (!length || !(bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51 || bytes[0] === 255 && (bytes[1] & 224) === 224)) throw new Error('Диск не вернул MP3.')
  if (expectedSha256) {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    if (hash !== expectedSha256) throw new Error('Аудиозапись не совпадает с библиотекой.')
  }
  return URL.createObjectURL(blob)
}

function publicDiskUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !['yadi.sk', 'disk.yandex.ru'].includes(url.hostname)) {
    throw new Error('Ожидалась публичная ссылка Яндекс.Диска.')
  }
  return url.toString()
}

/** @see ../../docs/modules/materials/materials.md#material-reader */
export function publicResource(value: string, size: string, refresh = false): Promise<PublicResource> {
  const url = publicDiskUrl(value)
  const key = `${url}:${size}`
  if (refresh) resources.delete(key)
  if (!resources.has(key)) {
    const endpoint = new URL('https://cloud-api.yandex.net/v1/disk/public/resources')
    endpoint.searchParams.set('public_key', url)
    endpoint.searchParams.set('preview_size', size)
    const request = fetchWithRetry(endpoint, { cache: refresh ? 'no-store' : 'default' }, { attempts: 2, timeoutMs: 7_000 }).then(async (response) => {
      if (!response.ok) throw new Error(`Яндекс.Диск: ${response.status}`)
      return response.json() as Promise<PublicResource>
    }).catch((error: unknown) => { resources.delete(key); throw error })
    resources.set(key, request)
  }
  return resources.get(key)!
}

/** @see ../../docs/modules/materials/materials.md#material-reader */
export async function publicImage(value: string, size = 'XXXL', refresh = false) {
  // A public attachment can be a PDF: its download URL works in a reader but
  // cannot be decoded by <img>. Refresh the image preview after a load error.
  try {
    const resource = await publicResource(value, size, refresh)
    if (resource.preview) return resource.preview
    if (resource.file) return resource.file
  } catch { /* Try the public download endpoint if preview metadata is unavailable. */ }
  const endpoint = new URL('https://cloud-api.yandex.net/v1/disk/public/resources/download')
  endpoint.searchParams.set('public_key', publicDiskUrl(value))
  const response = await fetchWithRetry(endpoint, { cache: 'no-store' }, { attempts: 2, timeoutMs: 7_000 })
  if (!response.ok) throw new Error(`Яндекс.Диск: ${response.status}`)
  const download = await response.json() as { href?: string }
  if (!download.href) throw new Error('Диск не вернул изображение для просмотра.')
  return download.href
}
