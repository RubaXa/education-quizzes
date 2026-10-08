import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'

/** @see ../docs/product/storage-privacy.md#private-archive */
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const familyRoot = resolve(projectRoot, '..')
const manifestFile = resolve(projectRoot, '.local/archive-manifest.json')
const errorFile = resolve(projectRoot, '.local/archive-errors.json')
const tokenFile = resolve(projectRoot, '.local/yandex-disk-token')
const extensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf'])
const sources = [
  'work', 'library', 'assessments', 'output', 'reports', 'events',
  'education-quizzes/.local/day-evidence',
  'education-quizzes/.local/diary/files',
  'education-quizzes/.local/english-evidence-preview.jpg',
]

function mediaFiles(folder) {
  if (!existsSync(folder)) return []
  if (statSync(folder).isFile()) return extensions.has(folder.slice(folder.lastIndexOf('.')).toLowerCase()) ? [folder] : []
  const result = []
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name)
    if (entry.isDirectory()) result.push(...mediaFiles(path))
    else if (entry.isFile() && extensions.has(entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase())) result.push(path)
  }
  return result
}

function hash(bytes, algorithm) { return createHash(algorithm).update(bytes).digest('hex') }
function save(value) { writeFileSync(manifestFile, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }) }

if (!existsSync(tokenFile)) throw new Error('Сначала подключите Яндекс.Диск командой storage connect.')
mkdirSync(resolve(projectRoot, '.local'), { recursive: true })
const storage = new YandexDiskStorage(readFileSync(tokenFile, 'utf8').trim())
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { schema: 1, files: {} }
const files = sources.flatMap((source) => mediaFiles(resolve(familyRoot, source))).sort()
const errors = []
let uploaded = 0
let verified = 0
let next = 0
let processed = 0

async function worker() {
while (next < files.length) {
  const file = files[next++]
  const rel = relative(familyRoot, file).split('\\').join('/')
  const bytes = readFileSync(file)
  const md5 = hash(bytes, 'md5')
  const sha256 = hash(bytes, 'sha256')
  const diskPath = `app:/PETR/Личный архив/${rel}`
  try {
    const known = manifest.files[rel]
    const remote = await storage.head(diskPath)
    if (remote?.type === 'file' && remote.size === bytes.length && remote.md5?.toLowerCase() === md5
      && known?.sha256 === sha256) {
      verified += 1
    } else {
      await storage.putAt(diskPath, bytes, md5)
      const confirmed = await storage.head(diskPath)
      if (confirmed?.type !== 'file' || confirmed.size !== bytes.length || confirmed.md5?.toLowerCase() !== md5) {
        throw new Error('Диск не подтвердил размер и контрольную сумму.')
      }
      manifest.files[rel] = { path: diskPath, size: bytes.length, md5, sha256, verifiedAt: new Date().toISOString() }
      save(manifest)
      uploaded += 1
    }
  } catch (error) {
    errors.push({ path: rel, message: error instanceof Error ? error.message : String(error) })
    writeFileSync(errorFile, `${JSON.stringify(errors, null, 2)}\n`, { mode: 0o600 })
  }
  processed += 1
  if (processed % 25 === 0) {
    console.log(JSON.stringify({ processed, total: files.length, uploaded, verified, failed: errors.length }))
  }
}
}

await Promise.all(Array.from({ length: 5 }, () => worker()))

if (!errors.length && existsSync(errorFile)) writeFileSync(errorFile, '[]\n', { mode: 0o600 })
console.log(JSON.stringify({ total: files.length, uploaded, verified, failed: errors.length }))
if (errors.length) process.exitCode = 1
