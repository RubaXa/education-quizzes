import { createHash } from 'node:crypto'
import { SubmissionStoragePort } from './submission-storage.mjs'

const api = 'https://cloud-api.yandex.net/v1/disk'

function diskUrl(resource, path, extra = {}) {
  const url = new URL(`${api}/${resource}`)
  url.searchParams.set('path', path)
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, String(value))
  return url
}

function validUploadUrl(href) {
  const url = new URL(href)
  if (url.protocol !== 'https:' || !/(^|\.)yandex\.(net|ru)$/.test(url.hostname)) {
    throw new Error('Яндекс Диск вернул недопустимый адрес загрузки.')
  }
  return url
}

function validDownloadUrl(href) {
  const url = new URL(href)
  if (url.protocol !== 'https:' || !/(^|\.)(yandex\.(net|ru)|yandexcloud\.net)$/.test(url.hostname)) {
    throw new Error('Яндекс Диск вернул недопустимый адрес скачивания.')
  }
  return url
}

/** @see ../docs/product/storage-privacy.md#storage-migration */
export class YandexDiskStorage extends SubmissionStoragePort {
  constructor(token, { fetcher = fetch } = {}) {
    super()
    if (!token) throw new Error('Нет токена Яндекс Диска.')
    this.token = token
    this.fetcher = fetcher
    this.knownFolders = new Set()
  }

  async request(method, resource, path, extra) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await this.fetcher(diskUrl(resource, path, extra), {
          method,
          headers: { Authorization: `OAuth ${this.token}`, Accept: 'application/json' },
        })
        if (response.status === 404) return null
        if (response.status === 409 && method === 'PUT') return { alreadyExists: true }
        if ([423, 429, 500, 502, 503, 504].includes(response.status) && attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
          continue
        }
        if (!response.ok) throw new Error(`Яндекс Диск: запрос ${method} ${resource} завершился HTTP ${response.status}.`)
        const body = await response.text()
        return body ? JSON.parse(body) : {}
      } catch (error) {
        if (attempt === 4 || error instanceof Error && error.message.startsWith('Яндекс Диск:')) throw error
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
      }
    }
  }

  async ensureFolder(path) {
    if (this.knownFolders.has(path)) return
    const result = await this.request('PUT', 'resources', path)
    if (result === null) throw new Error('Яндекс Диск не создал папку приложения.')
    const folder = await this.head(path)
    if (folder?.type !== 'dir') throw new Error('Папка приложения на Яндекс Диске недоступна.')
    this.knownFolders.add(path)
  }

  async head(path) {
    return this.request('GET', 'resources', path, { fields: 'path,type,size,md5,public_url' })
  }

  async put(key, bytes, expectedMd5 = createHash('md5').update(bytes).digest('hex')) {
    if (!/^\d{4}-\d{2}-\d{2}\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(key)) throw new Error('Недопустимый ключ вложения.')
    const [date] = key.split('/')
    const path = `app:/PETR/${date}/${key.split('/')[1]}`
    return this.putAt(path, bytes, expectedMd5)
  }

  async putAt(path, bytes, expectedMd5 = createHash('md5').update(bytes).digest('hex')) {
    if (!path.startsWith('app:/PETR/') || path.split('/').some((part) => part === '.' || part === '..' || !part)) throw new Error('Недопустимый путь вложения.')
    const parts = path.slice('app:/'.length).split('/')
    for (let length = 1; length < parts.length; length += 1) {
      await this.ensureFolder(`app:/${parts.slice(0, length).join('/')}`)
    }
    const existing = await this.head(path)
    if (existing) return this.verify(existing, bytes, expectedMd5, path)
    const link = await this.request('GET', 'resources/upload', path, { overwrite: false })
    if (!link || link.method !== 'PUT' || !link.href) throw new Error('Яндекс Диск не выдал ссылку загрузки.')
    const response = await this.fetcher(validUploadUrl(link.href), { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } })
    if (!response.ok && response.status !== 409) throw new Error(`Загрузка на Яндекс Диск завершилась HTTP ${response.status}.`)
    let remote = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      remote = await this.head(path)
      if (remote?.size === bytes.length) break
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
    if (!remote) throw new Error('Загрузка завершилась, но файл на Диске пока не найден; повторите команду.')
    return this.verify(remote, bytes, expectedMd5, path)
  }

  async publish(path) {
    if (!path.startsWith('app:/PETR/')) throw new Error('Можно публиковать только файлы PETR.')
    let remote = await this.head(path)
    if (remote?.type !== 'file') throw new Error('Файл для публикации не найден на Диске.')
    if (!remote.public_url) await this.request('PUT', 'resources/publish', path)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      remote = await this.head(path)
      if (remote?.public_url) return remote.public_url
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
    throw new Error('Диск не вернул публичную ссылку; повторите команду.')
  }

  async getAt(path) {
    if (!path.startsWith('app:/PETR/')) throw new Error('Можно скачать только файл приложения.')
    const remote = await this.head(path)
    if (remote?.type !== 'file' || !remote.md5) throw new Error('Файл на Диске не найден или его контрольная сумма недоступна.')
    const link = await this.request('GET', 'resources/download', path)
    if (!link?.href) throw new Error('Диск не выдал ссылку скачивания.')
    const response = await this.fetcher(validDownloadUrl(link.href))
    if (!response.ok) throw new Error(`Скачивание с Диска завершилось HTTP ${response.status}.`)
    const bytes = Buffer.from(await response.arrayBuffer())
    this.verify(remote, bytes, createHash('md5').update(bytes).digest('hex'), path)
    return bytes
  }

  /** @see ../docs/product/storage-privacy.md#photo-deletion */
  async removeWorkAt(path, expectedMd5) {
    if (!/^app:\/PETR\/Работы\/\d{4}-\d{2}-\d{2}\/[^/]+\/[A-Za-z0-9_-]{20,}\.(jpg|png|webp|heic|heif)$/.test(path)) {
      throw new Error('Удалять можно только отдельный файл ученической работы.')
    }
    if (!/^[a-f0-9]{32}$/i.test(expectedMd5 ?? '')) throw new Error('Нельзя удалить файл без проверенной контрольной суммы.')
    let remote = await this.head(path)
    if (!remote) return
    if (remote.type !== 'file' || remote.md5?.toLowerCase() !== expectedMd5.toLowerCase()) {
      throw new Error(`Файл на Яндекс.Диске не совпадает с удаляемой работой: ${path}.`)
    }
    if (remote.public_url) await this.request('DELETE', 'resources/unpublish', path)
    await this.request('DELETE', 'resources', path, { permanently: false, force_async: false })
    for (let attempt = 0; attempt < 6; attempt += 1) {
      remote = await this.head(path)
      if (!remote) return
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
    throw new Error('Файл ещё виден на Яндекс.Диске; повторите синхронизацию.')
  }

  verify(remote, bytes, expectedMd5, path) {
    if (remote.type !== 'file' || remote.size !== bytes.length || (remote.md5 && remote.md5.toLowerCase() !== expectedMd5)) {
      throw new Error(`Файл на Яндекс Диске не совпадает с локальным: ${path}.`)
    }
    return { provider: 'yandex-disk', path, size: bytes.length, md5: expectedMd5 }
  }
}
