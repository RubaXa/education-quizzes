import { fetchWithRetry } from './networkRetry'

type PublicResource = { preview?: string; file?: string }

const resources = new Map<string, Promise<PublicResource>>()

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
