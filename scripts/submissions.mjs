import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { resolveSubmission } from '../storage/submission-inbox.mjs'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'

/** Private agent inbox; file bytes stay on Yandex Disk or in ignored .local.
 * @see ../docs/product/storage-privacy.md#review-queue
 */
const [command, dateFilter] = process.argv.slice(2)
if (!['inbox', 'pull'].includes(command) || (dateFilter && !/^\d{4}-\d{2}-\d{2}$/.test(dateFilter))) {
  throw new Error('Использование: npm run submissions -- inbox|pull [YYYY-MM-DD]')
}
const local = resolve('.local')
const adcFile = resolve(local, 'adc.json')
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  if (!existsSync(adcFile)) throw new Error('Сначала войдите в Firebase CLI и создайте локальный ADC файл.')
  process.env.GOOGLE_APPLICATION_CREDENTIALS = adcFile
}
initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
const db = getFirestore()

async function pendingInbox() {
  const owners = await db.collection('dayOwners').get()
  const rows = []
  for (const ownerDoc of owners.docs) {
    const owner = ownerDoc.data()
    if (dateFilter && owner.date !== dateFilter) continue
    const [pageDoc, childDoc, files] = await Promise.all([
      db.doc(`dayPages/${ownerDoc.id}`).get(),
      db.doc(`families/${owner.familyId}/children/${owner.childId}`).get(),
      db.collection(`dayUploads/${ownerDoc.id}/files`).get(),
    ])
    if (!childDoc.exists) throw new Error(`Профиль владельца дня ${owner.date} не найден.`)
    for (const file of files.docs) {
      const upload = file.data()
      if (upload.status !== 'pending') continue
      rows.push({
        context: resolveSubmission({ owner, page: pageDoc.data(), childName: childDoc.data().displayName,
          uploadId: file.id, upload }),
        upload,
      })
    }
  }
  rows.sort((a, b) => (a.context.uploadedAt ?? '').localeCompare(b.context.uploadedAt ?? ''))
  return rows
}

function privatePhoto(upload) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(upload.dataUrl ?? '')
  if (!match) throw new Error('Временные байты фото отсутствуют или повреждены.')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length) throw new Error('Временное фото пусто.')
  return { bytes, extension: match[1] === 'jpeg' ? 'jpg' : match[1] }
}

const rows = await pendingInbox()
if (command === 'inbox') {
  console.log(JSON.stringify({ pending: rows.length, works: rows.map(({ context }) => context) }, null, 2))
} else {
  const output = resolve(local, 'submission-inbox')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const tokenFile = resolve(local, 'yandex-disk-token')
  const diskToken = process.env.YANDEX_DISK_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '')
  const storage = diskToken ? new YandexDiskStorage(diskToken) : null
  const manifest = []
  for (const { context, upload } of rows) {
    if (context.fileState === 'missing-file') throw new Error(`У ожидающего фото ${context.uploadId} нет файла.`)
    if (context.fileState === 'on-disk' && !storage) throw new Error('Для скачивания работ подключите Яндекс.Диск.')
    const photo = context.fileState === 'on-disk'
      ? { bytes: await storage.getAt(context.diskPath), extension: context.diskPath.split('.').at(-1) }
      : privatePhoto(upload)
    if (upload.storage?.sha256 && createHash('sha256').update(photo.bytes).digest('hex') !== upload.storage.sha256) {
      throw new Error(`Контрольная сумма фото ${context.uploadId} не совпала.`)
    }
    const file = `${context.dayDate}-${context.uploadId}.${photo.extension}`
    writeFileSync(resolve(output, file), photo.bytes, { mode: 0o600 })
    manifest.push({ ...context, file })
  }
  writeFileSync(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ directory: output, pending: manifest.length,
    needsManualLink: manifest.filter((item) => item.resolution !== 'linked').length }, null, 2))
}
