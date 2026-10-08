import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readJson, writeJson } from './local-store.mjs'

const maxBytes = 25 * 1024 * 1024
const extensions = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'])

function safeSource(urlString) {
  const url = new URL(urlString)
  if (url.protocol !== 'https:' || url.hostname !== 'school.mos.ru' || !url.pathname.startsWith('/ej/attachments/files/')) {
    throw new Error('Вложение МЭШ указывает на неожиданный адрес.')
  }
  const extension = decodeURIComponent(url.pathname.split('/').at(-1)).split('.').at(-1)?.toLowerCase()
  if (!extensions.has(extension)) throw new Error('Формат вложения пока не поддерживается.')
  return { url, extension }
}

async function download(url, token) {
  const response = await fetch(url, { headers: { 'Auth-Token': token }, redirect: 'manual', signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`МЭШ вернул HTTP ${response.status} при скачивании вложения.`)
  if (Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('Вложение МЭШ превышает лимит 25 МБ.')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > maxBytes) throw new Error('Вложение МЭШ превышает лимит 25 МБ.')
    chunks.push(chunk)
  }
  return { bytes: Buffer.concat(chunks), contentType: response.headers.get('content-type') || 'application/octet-stream' }
}

export async function downloadDayAttachments(dataDir, date, token) {
  const snapshot = readJson(dataDir, `snapshot-${date}.json`)
  if (!snapshot?.complete) throw new Error('Для даты нужен полный снимок МЭШ.')
  const directory = resolve(dataDir, 'files', date)
  const manifestFile = join(directory, 'manifest.json')
  const known = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {}
  mkdirSync(directory, { recursive: true })
  let stored = 0
  let skipped = 0
  const failures = []
  for (const assignment of snapshot.assignments || []) {
    for (const file of assignment.teacherFiles || []) {
      try {
        const { url, extension } = safeSource(file.url)
        const key = createHash('sha256').update(url.toString()).digest('hex').slice(0, 20)
        const name = `${key}.${extension}`
        if (known[key]?.url === url.toString() && existsSync(join(directory, name))) { skipped += 1; continue }
        const { bytes, contentType } = await download(url, token)
        const temporary = join(directory, `${name}.tmp`)
        writeFileSync(temporary, bytes, { mode: 0o600 })
        renameSync(temporary, join(directory, name))
        known[key] = {
          sourceItemId: assignment.sourceItemId, id: file.id, title: file.title, scope: file.scope,
          url: url.toString(), file: name, contentType, size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'), downloadedAt: new Date().toISOString(),
        }
        writeJson(directory, 'manifest.json', known)
        stored += 1
      } catch (error) { failures.push(`${assignment.sourceItemId}: ${error.message}`) }
    }
  }
  return { date, total: (snapshot.assignments || []).reduce((sum, item) => sum + (item.teacherFiles?.length || 0), 0), stored, alreadyStored: skipped, failed: failures }
}
