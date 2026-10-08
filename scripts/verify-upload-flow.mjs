import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'

/**
 * Read-only archive audit by default; --exercise temporarily submits a generated
 * image through the browser SDK, transfers it to Disk, pulls the review queue,
 * then removes only the generated record and file.
 * @see ../docs/product/storage-privacy.md#upload-verification
 */
const date = process.argv.find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
const exercise = process.argv.includes('--exercise')
const recover = process.argv.includes('--cleanup')
if (!date) throw new Error('Укажите дату страницы: node scripts/verify-upload-flow.mjs YYYY-MM-DD [--exercise]')

const root = resolve(import.meta.dirname, '..')
const local = resolve(root, '.local')
const recoveryFile = resolve(local, 'upload-flow-check-recovery.json')
const links = JSON.parse(readFileSync(resolve(local, 'day-links.json'), 'utf8'))
const studentToken = links[date]?.student
if (!studentToken) throw new Error('Для этой даты нет ученической страницы.')
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = resolve(local, 'adc.json')
}
const diskTokenFile = resolve(local, 'yandex-disk-token')
if (!existsSync(diskTokenFile)) throw new Error('Яндекс.Диск не подключён.')
const disk = new YandexDiskStorage(readFileSync(diskTokenFile, 'utf8').trim())
initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
const db = getFirestore()
const uploads = db.collection(`dayUploads/${studentToken}/files`)

function check(value, message) { if (!value) throw new Error(message) }
function digest(bytes, algorithm) { return createHash(algorithm).update(bytes).digest('hex') }

function pngChunk(name, data) {
  const type = Buffer.from(name, 'ascii')
  const body = Buffer.concat([type, data])
  let crc = 0xffffffff
  for (const byte of body) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([size, body, checksum])
}

function testPng() {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(1, 4)
  header[8] = 8
  header[9] = 6
  const pixel = Buffer.concat([Buffer.from([0]), randomBytes(3), Buffer.from([255])])
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixel)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

async function audit() {
  const snapshot = await uploads.get()
  const result = { date, total: snapshot.size, pending: 0, deleted: 0, onDisk: 0, waitingForDisk: 0, diskMatched: 0, diskMismatched: 0 }
  for (const item of snapshot.docs) {
    const upload = item.data()
    if (upload.status === 'deleted') { result.deleted++; continue }
    if (upload.status === 'pending') result.pending++
    if (upload.storage?.state === 'stored') {
      result.onDisk++
      const remote = await disk.head(upload.storage.path)
      if (remote?.type === 'file' && remote.size === upload.storage.size
        && remote.md5?.toLowerCase() === upload.storage.md5?.toLowerCase()) result.diskMatched++
      else result.diskMismatched++
    } else result.waitingForDisk++
  }
  console.log(JSON.stringify(result))
  check(!result.diskMismatched, 'Файл на Диске не совпадает с записью Firestore.')
  return result
}

async function cleanup(marker) {
  check(marker?.date === date && marker.studentToken === studentToken
    && /^[A-Za-z0-9]{20}$/.test(marker.id ?? '')
    && /^[a-f0-9]{64}$/.test(marker.sha256 ?? '')
    && marker.path?.startsWith(`app:/PETR/Работы/${date}/`)
    && marker.path.endsWith(`/${studentToken}-${marker.id}.png`), 'Маркер очистки не принадлежит этой проверке.')
  const ref = uploads.doc(marker.id)
  const snapshot = await ref.get()
  if (snapshot.exists) {
    const data = snapshot.data()
    const queued = data.originalName === 'integration-check.png'
      && data.dataUrl?.startsWith('data:image/png;base64,')
      && digest(Buffer.from(data.dataUrl.split(',')[1], 'base64'), 'sha256') === marker.sha256
    check(queued || data.storage?.sha256 === marker.sha256, 'Временная запись не совпадает с тестовым изображением.')
    await ref.delete()
  }
  if (await disk.head(marker.path)) await disk.request('DELETE', 'resources', marker.path, { permanently: true })
  check(!(await disk.head(marker.path)) && !(await ref.get()).exists, 'Тестовые данные не удалось удалить полностью.')
  rmSync(recoveryFile, { force: true })
}

if (recover) {
  check(existsSync(recoveryFile), 'Тестовых данных для очистки нет.')
  await cleanup(JSON.parse(readFileSync(recoveryFile, 'utf8')))
  console.log(JSON.stringify({ date, temporaryDataRemoved: true }))
  process.exit(0)
}

await audit()
if (exercise) {
  check(!existsSync(recoveryFile), 'Предыдущая проверка не очищена. Сначала запустите эту команду с --cleanup.')
  const page = (await db.doc(`dayPages/${studentToken}`).get()).data()
  const previous = (await uploads.get()).docs.map((item) => item.data())
  const taskId = page?.subjects?.flatMap((subject) => subject.tasks ?? [])
    .find((task) => task.kind === 'written' && task.status !== 'verified' && page.taskIds?.includes(task.id)
      && (!previous.some((item) => item.taskId === task.id && item.status === 'reviewed')
        || previous.some((item) => item.taskId === task.id && item.status === 'pending')
        || task.status === 'needs-fix' || task.status === 'partial'))?.id
  check(taskId, 'На этой странице нет письменного пункта для проверки загрузки.')
  const subject = { en: 'Английский', math: 'Математика', ru: 'Русский-язык', sp: 'Спецкурс' }[taskId.split('-')[0]] ?? 'Прочее'
  const bytes = testPng()
  const sha256 = digest(bytes, 'sha256')
  let testRef
  let clientDb
  let path
  let temporaryDirectory
  let completed = false
  try {
    const { db: browserDb } = await import('../src/lib/firebase.ts')
    const { doc, collection, setDoc, serverTimestamp, terminate } = await import('firebase/firestore')
    clientDb = browserDb
    testRef = doc(collection(clientDb, 'dayUploads', studentToken, 'files'))
    path = `app:/PETR/Работы/${date}/${subject}/${studentToken}-${testRef.id}.png`
    check(!(await disk.head(path)), 'Тестовый путь уже занят; повторите проверку.')
    await setDoc(testRef, {
      taskId,
      dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
      originalName: 'integration-check.png',
      status: 'pending',
      createdAt: serverTimestamp(),
    })
    writeFileSync(recoveryFile, JSON.stringify({ date, studentToken, id: testRef.id, path, sha256 }), { mode: 0o600 })
    await terminate(clientDb)
    clientDb = null

    const ref = uploads.doc(testRef.id)
    const queued = (await ref.get()).data()
    check(queued?.status === 'pending' && queued.dataUrl, 'Фото не попало во временную очередь Firestore.')
    execFileSync(process.execPath, ['scripts/storage.mjs', 'sync', date], { cwd: root, stdio: 'pipe' })
    const stored = (await ref.get()).data()
    check(stored?.status === 'pending' && stored.storage?.state === 'stored'
      && stored.storage?.path === path && stored.storage?.publicUrl?.startsWith('https://')
      && !stored.dataUrl && !stored.originalName, 'После переноса очередь или архивная запись некорректны.')
    check(digest(await disk.getAt(path), 'sha256') === digest(bytes, 'sha256'), 'Скачанный файл не совпадает с тестовым изображением.')

    temporaryDirectory = mkdtempSync(join(tmpdir(), 'petr-upload-check-'))
    execFileSync(process.execPath, ['scripts/day.mjs', 'pull', date, temporaryDirectory], { cwd: root, stdio: 'pipe' })
    const manifest = JSON.parse(readFileSync(join(temporaryDirectory, 'manifest.json'), 'utf8'))
    const entry = manifest.find((item) => item.id === testRef.id && item.status === 'pending')
    check(entry && digest(readFileSync(join(temporaryDirectory, entry.file)), 'sha256') === digest(bytes, 'sha256'),
      'Фото не появилось в очереди для педагогического разбора.')
    completed = true
  } finally {
    if (clientDb) {
      const { terminate } = await import('firebase/firestore')
      await terminate(clientDb)
    }
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
    if (testRef) await cleanup({ date, studentToken, id: testRef.id, path, sha256 })
  }
  check(completed, 'Сквозная проверка не завершилась.')
  console.log(JSON.stringify({ date, clientWrite: 'ok', diskTransfer: 'ok', reviewQueue: 'ok', temporaryDataRemoved: true }))
}
