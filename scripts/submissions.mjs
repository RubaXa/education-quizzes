import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { resolveSubmission } from '../storage/submission-inbox.mjs'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'

/** Private agent inbox; file bytes stay on Yandex Disk or in ignored .local.
 * @see ../docs/product/storage-privacy.md#review-queue
 */
const [command, argument] = process.argv.slice(2)
const dateFilter = command === 'review' ? null : argument
if (!['inbox', 'pull', 'review'].includes(command)
  || command === 'review' && !argument
  || dateFilter && !/^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
  throw new Error('Использование: npm run submissions -- inbox|pull [YYYY-MM-DD] | review .local/review-....json')
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

/** @see ../docs/product/storage-privacy.md#review-publication */
async function publishReview(filename) {
  const path = resolve(filename)
  if (!path.startsWith(`${local}/`) || !path.endsWith('.json')) throw new Error('Файл разбора должен лежать в закрытой папке .local/.')
  const review = JSON.parse(readFileSync(path, 'utf8'))
  const statuses = new Set(['verified', 'needs-fix', 'partial', 'cannot-assess'])
  const itemStatuses = new Set(['correct', 'incorrect', 'partial', 'cannot-assess'])
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.date ?? '') || !/^[a-z0-9-]+$/.test(review.taskId ?? '')
    || !Number.isInteger(review.planRevision) || !statuses.has(review.status)
    || !review.summary?.trim() || !review.nextStep?.trim() || !review.source?.trim()
    || !Array.isArray(review.uploadIds) || !review.uploadIds.length
    || new Set(review.uploadIds).size !== review.uploadIds.length
    || !review.uploadIds.every((id) => /^[A-Za-z0-9_-]{20,}$/.test(id))
    || !Array.isArray(review.items) || !review.items.length
    || !review.items.every((item) => item.label?.trim() && item.observed?.trim() && item.note?.trim() && itemStatuses.has(item.status))) {
    throw new Error('Неполный или некорректный разбор. Нужны дата, ревизия плана, фото, итог, действие, источник и проверенные пункты.')
  }
  if (review.status === 'verified' && review.items.some((item) => item.status !== 'correct')) {
    throw new Error('Нельзя отметить всю работу проверенной при ошибке в подпункте.')
  }
  const owners = (await db.collection('dayOwners').get()).docs.filter((item) => item.data().date === review.date)
  const matches = []
  for (const owner of owners) {
    const refs = review.uploadIds.map((id) => db.doc(`dayUploads/${owner.id}/files/${id}`))
    const photos = await Promise.all(refs.map((ref) => ref.get()))
    if (photos.every((photo) => photo.exists)) matches.push({ owner, refs, photos })
  }
  if (matches.length !== 1) throw new Error('Не удалось однозначно связать разбор с ребёнком и набором фотографий.')
  const { owner, refs, photos } = matches[0]
  const page = (await db.doc(`dayPages/${owner.id}`).get()).data()
  if (page?.kind !== 'student' || page.planRevision !== review.planRevision || !page.taskIds?.includes(review.taskId)) {
    throw new Error('Задание изменилось после скачивания фото. Сначала сверяйте новый план.')
  }
  if (photos.some((photo) => photo.data().status !== 'pending' || photo.data().taskId !== review.taskId || photo.data().storage?.state !== 'stored')) {
    throw new Error('Фото уже удалено, проверено, не относится к заданию или ещё не перенесено на Диск.')
  }
  const reviewRef = db.doc(`dayProgress/${owner.id}/items/${review.taskId}`)
  const previous = (await reviewRef.get()).data()
  const priorReviews = previous ? [...(previous.history ?? []), Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 'history'))] : []
  const now = Timestamp.now()
  const { date, taskId, planRevision, uploadIds, status, summary, nextStep, source, items } = review
  const batch = db.batch()
  batch.set(reviewRef, { date, taskId, planRevision, uploadIds, status, summary, nextStep, source, items,
    checkedAt: now, history: priorReviews.slice(-20) })
  refs.forEach((ref) => batch.update(ref, { status: 'reviewed', reviewedAt: now }))
  await batch.commit()
  console.log(JSON.stringify({ reviewedPhotos: refs.length, taskStatus: status, publishedToFirebase: true }))
}

if (command === 'review') {
  await publishReview(argument)
} else if (command === 'inbox') {
  const rows = await pendingInbox()
  console.log(JSON.stringify({ pending: rows.length, works: rows.map(({ context }) => context) }, null, 2))
} else {
  const rows = await pendingInbox()
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
