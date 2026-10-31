import { createHash } from 'node:crypto'
import { SubmissionStoragePort } from './submission-storage.mjs'

const api = 'https://cloud-api.yandex.net/v1/disk'
const transientStatuses = new Set([408, 423, 425, 429, 500, 502, 503, 504])
const maxServerPauseMs = 5 * 60_000

function retryAfterMs(header) {
  if (!header) return null
  const seconds = /^\d+$/.test(header.trim()) ? Number(header.trim()) : null
  if (seconds !== null) return Number.isSafeInteger(seconds) ? seconds * 1000 : null
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function backoffMs(attempt) {
  const ceiling = Math.min(30_000, 750 * 2 ** attempt)
  return Math.round(ceiling * (0.5 + Math.random() / 2))
}

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

/** @see ../docs/modules/materials/storage-privacy.md#storage-migration */
export class YandexDiskStorage extends SubmissionStoragePort {
  constructor(token, { fetcher = fetch } = {}) {
    super()
    if (!token) throw new Error('Нет токена Яндекс Диска.')
    this.token = token
    this.fetcher = fetcher
    this.knownFolders = new Set()
    this.retryUntil = 0
    this.lastRetryNoticeAt = 0
  }

  reportRetry(reason, attempt, attempts, pauseMs) {
    const now = Date.now()
    if (now - this.lastRetryNoticeAt < 30_000) return
    this.lastRetryNoticeAt = now
    // Never log a signed URL, OAuth token, family path or response body.
    console.warn(JSON.stringify({ event: 'yandex-network-retry', reason, attempt: attempt + 1, attempts, pauseMs }))
  }

  // One bounded policy for API calls and signed upload/download links.
  // @see ../docs/modules/materials/storage-privacy.md#network-resilience
  async fetchResilient(url, options = {}, { attempts = 8, timeoutMs = 60_000 } = {}) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const cooldown = this.retryUntil - Date.now()
      if (cooldown > 0) await delay(cooldown)
      try {
        const response = await this.fetcher(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
        if (!transientStatuses.has(response.status) || attempt === attempts - 1) return response
        const serverPause = retryAfterMs(response.headers?.get?.('retry-after'))
        if (serverPause !== null && serverPause > maxServerPauseMs) {
          throw new Error(`Яндекс Диск просит подождать ${Math.ceil(serverPause / 1000)} с; повторите синхронизацию позже.`)
        }
        const pause = Math.max(backoffMs(attempt), serverPause ?? 0)
        this.retryUntil = Math.max(this.retryUntil, Date.now() + pause)
        this.reportRetry(`HTTP ${response.status}`, attempt, attempts, pause)
        await delay(pause)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Яндекс Диск просит подождать')) throw error
        if (attempt === attempts - 1) throw new Error('Связь с Яндекс Диском не восстановилась после повторов.', { cause: error })
        const pause = backoffMs(attempt)
        this.retryUntil = Math.max(this.retryUntil, Date.now() + pause)
        this.reportRetry('network', attempt, attempts, pause)
        await delay(pause)
      }
    }
  }

  async request(method, resource, path, extra) {
    const response = await this.fetchResilient(diskUrl(resource, path, extra), {
      method,
      headers: { Authorization: `OAuth ${this.token}`, Accept: 'application/json' },
    })
    if (response.status === 404) return null
    if (response.status === 409 && method === 'PUT') return { alreadyExists: true }
    if (!response.ok) throw new Error(`Яндекс Диск: запрос ${method} ${resource} завершился HTTP ${response.status}.`)
    const body = await response.text()
    return body ? JSON.parse(body) : {}
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
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const link = await this.request('GET', 'resources/upload', path, { overwrite: false })
      if (!link || link.method !== 'PUT' || !link.href) throw new Error('Яндекс Диск не выдал ссылку загрузки.')
      try {
        const response = await this.fetchResilient(validUploadUrl(link.href), {
          method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' },
        }, { attempts: 4, timeoutMs: 120_000 })
        if (!response.ok && response.status !== 409) {
          if (!transientStatuses.has(response.status) && response.status !== 403) {
            throw new Error(`Загрузка на Яндекс Диск завершилась HTTP ${response.status}.`)
          }
        }
      } catch (error) {
        if (error instanceof Error && /завершилась HTTP|просит подождать/.test(error.message)) throw error
      }
      for (let visibilityAttempt = 0; visibilityAttempt < 8; visibilityAttempt += 1) {
        const remote = await this.head(path)
        if (remote) return this.verify(remote, bytes, expectedMd5, path)
        if (visibilityAttempt < 7) await delay(backoffMs(visibilityAttempt))
      }
      if (attempt === 2) throw new Error('Загрузка на Диск не подтверждена после повторов; повторите синхронизацию.')
      await delay(backoffMs(attempt))
    }
  }

  async publish(path) {
    if (!path.startsWith('app:/PETR/')) throw new Error('Можно публиковать только файлы PETR.')
    let remote = await this.head(path)
    if (remote?.type !== 'file') throw new Error('Файл для публикации не найден на Диске.')
    for (let publishAttempt = 0; publishAttempt < 2; publishAttempt += 1) {
      if (remote?.public_url) return remote.public_url
      await this.request('PUT', 'resources/publish', path)
      for (let attempt = 0; attempt < 8; attempt += 1) {
        remote = await this.head(path)
        if (remote?.public_url) return remote.public_url
        if (attempt < 7) await delay(backoffMs(attempt))
      }
    }
    throw new Error('Диск не вернул публичную ссылку; повторите команду.')
  }

  async getAt(path) {
    if (!path.startsWith('app:/PETR/')) throw new Error('Можно скачать только файл приложения.')
    const remote = await this.head(path)
    if (remote?.type !== 'file' || !remote.md5) throw new Error('Файл на Диске не найден или его контрольная сумма недоступна.')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const link = await this.request('GET', 'resources/download', path)
      if (!link?.href) throw new Error('Диск не выдал ссылку скачивания.')
      try {
        const response = await this.fetchResilient(validDownloadUrl(link.href), {}, { attempts: 4, timeoutMs: 120_000 })
        if (response.ok) {
          const bytes = Buffer.from(await response.arrayBuffer())
          this.verify(remote, bytes, createHash('md5').update(bytes).digest('hex'), path)
          return bytes
        }
        if (!transientStatuses.has(response.status) && response.status !== 403) {
          throw new Error(`Скачивание с Диска завершилось HTTP ${response.status}.`)
        }
      } catch (error) {
        if (error instanceof Error && /завершилось HTTP|не совпадает|просит подождать/.test(error.message)) throw error
      }
      if (attempt < 2) await delay(backoffMs(attempt))
    }
    throw new Error('Скачивание с Диска не удалось после повторов; повторите синхронизацию.')
  }

  /** Short-lived provider download, never a publicly published Disk resource.
   * @see ../docs/modules/assessments/olympiad-history.md */
  async downloadHrefAt(path) {
    if (!path.startsWith('app:/PETR/Семьи/')) throw new Error('private_learning_file_path_invalid')
    const remote = await this.head(path)
    if (remote?.type !== 'file' || remote.public_url) throw new Error('private_learning_file_not_private')
    const link = await this.request('GET', 'resources/download', path)
    if (!link?.href) throw new Error('private_learning_file_download_unavailable')
    return validDownloadUrl(link.href).href
  }

  /** @see ../docs/modules/materials/storage-privacy.md#photo-deletion */
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
    if (remote.public_url) await this.request('PUT', 'resources/unpublish', path)
    await this.request('DELETE', 'resources', path, { permanently: false, force_async: false })
    for (let attempt = 0; attempt < 6; attempt += 1) {
      remote = await this.head(path)
      if (!remote) return
      await delay(backoffMs(attempt))
    }
    throw new Error('Файл ещё виден на Яндекс.Диске; повторите синхронизацию.')
  }

  /** Remove only a verified temporary family material after it is in the shared archive. */
  async removeFamilyBookStagingAt(path, expectedMd5) {
    if (!/^app:\/PETR\/Учебники\/Загрузки\/[A-Za-z0-9_-]{20,80}\/[A-Za-z0-9_-]{20,80}\/[A-Za-z0-9_-]{20,80}\.pdf$/.test(path)) {
      throw new Error('Удалять можно только временную загрузку учебника.')
    }
    if (!/^[a-f0-9]{32}$/i.test(expectedMd5 ?? '')) throw new Error('Нельзя удалить загрузку без проверенной контрольной суммы.')
    const remote = await this.head(path)
    if (!remote) return
    if (remote.type !== 'file' || remote.md5?.toLowerCase() !== expectedMd5.toLowerCase()) {
      throw new Error('Временный файл на Диске не совпадает с проверенным оригиналом.')
    }
    if (remote.public_url) throw new Error('Временный файл неожиданно опубликован; требуется ручная проверка.')
    await this.request('DELETE', 'resources', path, { permanently: false, force_async: false })
  }

  verify(remote, bytes, expectedMd5, path) {
    if (remote.type !== 'file' || remote.size !== bytes.length || (remote.md5 && remote.md5.toLowerCase() !== expectedMd5)) {
      throw new Error(`Файл на Яндекс Диске не совпадает с локальным: ${path}.`)
    }
    return { provider: 'yandex-disk', path, size: bytes.length, md5: expectedMd5 }
  }
}
