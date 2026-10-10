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
const [command, argument, phase] = process.argv.slice(2)
const reviewCommand = command === 'review' || command === 'progress'
const dateFilter = reviewCommand ? null : argument
if (!['inbox', 'pull', 'review', 'progress'].includes(command)
  || reviewCommand && !argument
  || command === 'progress' && !['download', 'source', 'review', 'publish', 'paused'].includes(phase)
  || dateFilter && !/^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
  throw new Error('Использование: npm run submissions -- inbox|pull [YYYY-MM-DD] | progress .local/review-....json download|source|review|publish|paused | review .local/review-....json')
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
  const progressByTask = new Map()
  for (const { context } of rows) {
    const key = `${context.dayDate}:${context.taskId}:${context.childId}`
    if (progressByTask.has(key)) continue
    const owner = owners.docs.find((item) => item.data().date === context.dayDate && item.data().childId === context.childId)
    if (!owner) continue
    progressByTask.set(key, db.doc(`dayProgress/${owner.id}/items/${context.taskId}`).get().then((snapshot) => {
      const progress = snapshot.data()?.processing
      return progress ? {
        phase: progress.phase,
        label: progress.label ?? null,
        reason: progress.reason ?? null,
        uploadIds: progress.uploadIds ?? [],
        updatedAt: progress.updatedAt?.toDate?.().toISOString() ?? null,
      } : null
    }))
  }
  await Promise.all(progressByTask.values())
  for (const { context } of rows) {
    context.processing = await progressByTask.get(`${context.dayDate}:${context.taskId}:${context.childId}`) ?? null
  }
  return rows
}

function privatePhoto(upload) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(upload.dataUrl ?? '')
  if (!match) throw new Error('Временные байты фото отсутствуют или повреждены.')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length) throw new Error('Временное фото пусто.')
  return { bytes, extension: match[1] === 'jpeg' ? 'jpg' : match[1] }
}

function privateReviewFile(filename) {
  const path = resolve(filename)
  if (!path.startsWith(`${local}/`) || !path.endsWith('.json')) throw new Error('Файл разбора должен лежать в закрытой папке .local/.')
  const review = JSON.parse(readFileSync(path, 'utf8'))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.date ?? '') || !/^[a-z0-9-]+$/.test(review.taskId ?? '')
    || !Number.isInteger(review.planRevision) || !Array.isArray(review.uploadIds) || !review.uploadIds.length
    || new Set(review.uploadIds).size !== review.uploadIds.length
    || !review.uploadIds.every((id) => /^[A-Za-z0-9_-]{20,}$/.test(id))) {
    throw new Error('Нужны дата, ID задания, ревизия плана и уникальные ID фотографий.')
  }
  return review
}

async function linkedReviewPhotos(review) {
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
  if (photos.some((photo) => photo.data().status !== 'pending' || photo.data().taskId !== review.taskId)) {
    throw new Error('Фото уже удалено, проверено или не относится к заданию.')
  }
  return { owner, refs, photos, page }
}

/** @see ../docs/product/storage-privacy.md#review-publication */
async function publishProgress(filename, phase) {
  const review = privateReviewFile(filename)
  const { owner } = await linkedReviewPhotos(review)
  const labels = { download: 'Готовим фотографии', source: 'Сверяем с учебником', review: 'Разбираем ответы', publish: 'Сохраняем результат', paused: 'Фото получено · техническая задержка' }
  const reviewRef = db.doc(`dayProgress/${owner.id}/items/${review.taskId}`)
  const previous = (await reviewRef.get()).data()?.processing
  const samePhotos = previous?.uploadIds?.length === review.uploadIds.length && previous.uploadIds.every((id) => review.uploadIds.includes(id))
  const now = Timestamp.now()
  await reviewRef.set({ date: review.date, taskId: review.taskId, planRevision: review.planRevision,
    processing: { phase, label: labels[phase], ...(phase === 'paused' ? { reason: review.pausedReason?.trim() || 'Причина остановки пока не указана. Фото получено; повторно загружать его не нужно.' } : {}), uploadIds: review.uploadIds, startedAt: samePhotos ? previous.startedAt : now, updatedAt: now } }, { merge: true })
  console.log(JSON.stringify({ phase, publishedToFirebase: true }))
}

/** @see ../docs/product/storage-privacy.md#review-publication */
async function publishReview(filename) {
  const review = privateReviewFile(filename)
  const statuses = new Set(['verified', 'needs-fix', 'partial', 'cannot-assess'])
  const itemStatuses = new Set(['correct', 'incorrect', 'partial', 'cannot-assess'])
  if (!statuses.has(review.status)
    || !review.summary?.trim() || !review.nextStep?.trim() || !review.source?.trim()
    || !Array.isArray(review.items) || !review.items.length
    || !review.items.every((item) => item.label?.trim() && item.observed?.trim() && item.note?.trim() && itemStatuses.has(item.status))) {
    throw new Error('Неполный или некорректный разбор. Нужны дата, ревизия плана, фото, итог, действие, источник и проверенные пункты.')
  }
  if (review.status === 'verified' && review.items.some((item) => item.status !== 'correct')) {
    throw new Error('Нельзя отметить всю работу проверенной при ошибке в подпункте.')
  }
  const { owner, refs, photos, page } = await linkedReviewPhotos(review)
  const subject = page.subjects?.find((entry) => entry.tasks?.some((task) => task.id === review.taskId || task.problems?.some((problem) => problem.id === review.taskId)))
  const task = subject?.tasks?.find((entry) => entry.id === review.taskId || entry.problems?.some((problem) => problem.id === review.taskId))
  if (subject && ['math', 'special'].includes(subject.id) && task?.kind === 'written') {
    const reasoning = review.mathReasoning
    const answerStates = new Set(['correct', 'incorrect', 'uncertain'])
    const argumentStates = new Set(['sufficient', 'incomplete', 'not-shown', 'unreadable', 'not-required'])
    if (!reasoning || !answerStates.has(reasoning.answer) || !argumentStates.has(reasoning.argument)
      || !reasoning.observed?.trim()
      || ['incomplete', 'not-shown'].includes(reasoning.argument) && !reasoning.minimumNeeded?.trim()
      || reasoning.argument === 'not-required' && !reasoning.criterionSource?.trim()) {
      throw new Error('Для математического номера отдельно укажите ответ, видимый ход и один недостающий переход.')
    }
    if (review.status === 'verified' && (reasoning.answer !== 'correct' || !['sufficient', 'not-required'].includes(reasoning.argument))) {
      throw new Error('Полная проверка математического номера требует верного ответа и достаточного хода.')
    }
    if (reasoning.answer === 'correct' && ['incomplete', 'not-shown'].includes(reasoning.argument) && review.status !== 'partial') {
      throw new Error('Верный ответ без достаточного хода отмечается отдельно как частичный результат, не как ошибка ответа.')
    }
  }
  if (photos.some((photo) => photo.data().storage?.state !== 'stored')) throw new Error('Фото ещё не перенесено на Диск.')
  const reviewRef = db.doc(`dayProgress/${owner.id}/items/${review.taskId}`)
  const previous = (await reviewRef.get()).data()
  const priorReviews = previous?.status ? [...(previous.history ?? []), Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 'history' && key !== 'processing'))] : previous?.history ?? []
  const now = Timestamp.now()
  const { date, taskId, planRevision, uploadIds, status, summary, nextStep, source, items, mathReasoning } = review
  const batch = db.batch()
  batch.set(reviewRef, { date, taskId, planRevision, uploadIds, status, summary, nextStep, source, items,
    ...(mathReasoning ? { mathReasoning } : {}),
    checkedAt: now, history: priorReviews.slice(-20) })
  refs.forEach((ref) => batch.update(ref, { status: 'reviewed', reviewedAt: now }))
  await batch.commit()
  console.log(JSON.stringify({ reviewedPhotos: refs.length, taskStatus: status, publishedToFirebase: true }))
}

if (command === 'review') {
  await publishReview(argument)
} else if (command === 'progress') {
  await publishProgress(argument, phase)
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
