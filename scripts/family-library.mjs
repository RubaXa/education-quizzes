import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'
import { bookDisplayTitle, indexedBooks } from '../storage/textbook-catalog.mjs'
import { taskPageRefs } from '../storage/material-pages.mjs'

/** @see ../docs/product/family-library.md#operator */
const [command, familyId, childId, argument] = process.argv.slice(2)
const local = resolve('.local')
const adc = resolve(local, 'adc.json')
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) process.env.GOOGLE_APPLICATION_CREDENTIALS = adc
if (!existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) throw new Error('Нужен локальный .local/adc.json.')
initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
const db = getFirestore()
const pattern = /^[A-Za-z0-9_-]{20,80}$/

async function childExists() {
  if (!pattern.test(familyId ?? '') || !pattern.test(childId ?? '') || !(await db.doc(`families/${familyId}/children/${childId}`).get()).exists) {
    throw new Error('Укажите существующие familyId и childId.')
  }
}
async function link(book, source, upload) {
  const destination = db.doc(`families/${familyId}/children/${childId}/books/${book.id}`)
  const current = (await destination.get()).data()
  if (current?.status === 'confirmed' && current.sourceSha256 === book.sourceSha256) {
    if (upload) await upload.ref.update({ status: 'linked', bookId: book.id, linkedAt: Timestamp.now(), error: FieldValue.delete() })
    console.log(JSON.stringify({ familyId, childId, bookId: book.id, unchanged: true }))
    return
  }
  const batch = db.batch()
  batch.set(destination, {
    bookId: book.id, subjectKey: book.subject.toLocaleLowerCase('ru'),
    title: book.title ?? bookDisplayTitle(book), status: 'confirmed',
    sourceSha256: book.sourceSha256, evidence: source, confirmedAt: Timestamp.now(),
  }, { merge: true })
  if (upload) batch.update(upload.ref, { status: 'linked', bookId: book.id, linkedAt: Timestamp.now(), error: FieldValue.delete() })
  await batch.commit()
  console.log(JSON.stringify({ familyId, childId, bookId: book.id, source }))
}

if (command === 'inbox') {
  if (!pattern.test(familyId ?? '')) throw new Error('Использование: npm run family:library -- inbox <familyId>')
  const children = await db.collection(`families/${familyId}/children`).get()
  const rows = await Promise.all(children.docs.map(async (child) => ({ childId: child.id,
    docs: (await child.ref.collection('bookUploads').get()).docs })))
  console.log(JSON.stringify(rows.flatMap(({ childId, docs }) => docs.map((item) => ({ uploadId: item.id, childId,
    subjectKey: item.data().subjectKey, originalName: item.data().originalName,
    sha256: item.data().sha256, status: item.data().status, storagePath: item.data().storage?.path ?? null }))), null, 2))
} else if (command === 'pull') {
  await childExists()
  if (!pattern.test(argument ?? '')) throw new Error('Использование: npm run family:library -- pull <familyId> <childId> <uploadId>')
  const upload = (await db.doc(`families/${familyId}/children/${childId}/bookUploads/${argument}`).get()).data()
  if (upload?.status !== 'needs-identification' || !upload.storage?.path) throw new Error('Файл не готов к разбору.')
  const tokenFile = resolve(local, 'yandex-disk-token')
  if (!existsSync(tokenFile)) throw new Error('Нужен локальный токен Яндекс.Диска.')
  const disk = new YandexDiskStorage(readFileSync(tokenFile, 'utf8').trim())
  const bytes = await disk.getAt(upload.storage.path)
  const extension = upload.contentType === 'application/pdf' ? 'pdf' : upload.contentType.split('/')[1]
  const target = resolve(local, 'family-library-inbox', `${upload.sha256}.${extension}`)
  mkdirSync(resolve(local, 'family-library-inbox'), { recursive: true })
  if (existsSync(target)) {
    if (createHash('sha256').update(readFileSync(target)).digest('hex') !== upload.sha256) throw new Error('Локальный файл с этим именем имеет другой хэш.')
  } else writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ target, sha256: upload.sha256, subject: upload.subjectKey }))
} else if (command === 'link') {
  await childExists()
  const [uploadId, bookId] = process.argv.slice(5)
  if (!pattern.test(uploadId ?? '') || !/^[a-z0-9-]+$/.test(bookId ?? '')) throw new Error('Использование: npm run family:library -- link <familyId> <childId> <uploadId> <bookId>')
  const ref = db.doc(`families/${familyId}/children/${childId}/bookUploads/${uploadId}`)
  const [upload, book] = await Promise.all([ref.get(), db.doc(`materialBooks/${bookId}`).get()])
  const data = upload.data(), material = book.data()
  if (data?.status !== 'needs-identification' || !material || material.role !== 'student-textbook') throw new Error('Загрузка или индексированный учебник не найдены.')
  if (material.sourceSha256 !== data.sha256 || material.subject?.toLocaleLowerCase('ru') !== data.subjectKey) {
    throw new Error('Хэш или предмет не совпадают: сначала зарегистрируйте точное издание и опубликуйте каталог.')
  }
  await link({ id: book.id, ...material }, { kind: 'family-upload-indexed', uploadId }, { ref })
} else if (command === 'link-edition') {
  await childExists()
  const [uploadId, bookId, evidenceFile] = process.argv.slice(5)
  if (!pattern.test(uploadId ?? '') || !/^[a-z0-9-]+$/.test(bookId ?? '') || !evidenceFile) {
    throw new Error('Использование: npm run family:library -- link-edition <familyId> <childId> <uploadId> <bookId> <evidence.json>')
  }
  const evidencePath = resolve(evidenceFile)
  if (!evidencePath.startsWith(resolve(local, 'family-library-evidence') + '/') || !existsSync(evidencePath)) {
    throw new Error('Сверку издания сохраните в закрытой .local/family-library-evidence/.')
  }
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
  const ref = db.doc(`families/${familyId}/children/${childId}/bookUploads/${uploadId}`)
  const [upload, book] = await Promise.all([ref.get(), db.doc(`materialBooks/${bookId}`).get()])
  const data = upload.data(), material = book.data()
  if (data?.status !== 'needs-identification' || !material || material.role !== 'student-textbook'
    || material.subject?.toLocaleLowerCase('ru') !== data.subjectKey) throw new Error('Нет загрузки или подходящего индексированного издания.')
  if (evidence.uploadSha256 !== data.sha256 || evidence.bookId !== bookId || evidence.targetSha256 !== material.sourceSha256
    || evidence.conclusion !== 'same-edition-and-content' || !Array.isArray(evidence.comparedPages)
    || evidence.comparedPages.length < 2 || new Set(evidence.comparedPages.map((page) => page.uploadPage)).size < 2
    || evidence.comparedPages.some((page) => !Number.isInteger(page.uploadPage) || !Number.isInteger(page.catalogPage)
      || page.uploadPage < 1 || page.catalogPage < 1 || page.catalogPage > material.pdfPageCount || page.match !== true)
    || typeof evidence.editionEvidence !== 'string' || evidence.editionEvidence.trim().length < 30) {
    throw new Error('Нужна предметная сверка издания, выходных данных и минимум двух разных страниц PDF.')
  }
  await link({ id: book.id, ...material, sourceSha256: data.sha256 }, {
    kind: 'same-edition-verified', uploadId, targetSha256: material.sourceSha256,
    editionEvidence: evidence.editionEvidence.trim(), comparedPages: evidence.comparedPages,
    evidenceFile: evidencePath.slice(resolve(local).length + 1),
  }, { ref })
} else if (command === 'seed-existing') {
  await childExists()
  const accessRegistry = resolve(local, 'family-access.json')
  const legacyOwner = existsSync(accessRegistry) ? JSON.parse(readFileSync(accessRegistry, 'utf8')).legacyDayOwner : null
  if (legacyOwner?.familyId !== familyId || legacyOwner?.childId !== childId) {
    throw new Error('Старый комплект можно перенести только ребёнку, которому принадлежат прежние семейные материалы.')
  }
  // A catalog status is global metadata, not proof that this family supplied
  // the full PDF. Require an explicit closed ownership manifest per edition.
  const ownershipFile = resolve(local, 'family-library-evidence', 'legacy-seed.json')
  if (!existsSync(ownershipFile)) throw new Error('Нужен закрытый список семейных PDF с доказательством происхождения для каждого издания.')
  const manifest = JSON.parse(readFileSync(ownershipFile, 'utf8'))
  if (manifest.familyId !== familyId || manifest.childId !== childId || !Array.isArray(manifest.books)) {
    throw new Error('Список семейных PDF относится к другой семье или имеет неверный формат.')
  }
  const indexed = new Map(indexedBooks().map((entry) => [entry.book.id, entry]))
  if (new Set(manifest.books.map((item) => item.bookId)).size !== manifest.books.length) throw new Error('В списке есть повтор издания.')
  const verified = []
  for (const item of manifest.books) {
    const entry = indexed.get(item.bookId)
    const bindingStatus = item.bindingStatus ?? 'confirmed'
    const editionAllowed = bindingStatus === 'provisional'
      ? entry?.book.edition_status === 'parallel-edition'
      : ['family-supplied', 'family-page-matched', 'exact-edition-confirmed'].includes(entry?.book.edition_status)
    if (!entry || !editionAllowed
      || entry.index.source_sha256 !== item.sourceSha256
      || typeof item.ownershipEvidence !== 'string' || item.ownershipEvidence.trim().length < 30) {
      throw new Error(`Нет точного доказательства семейного PDF для ${item.bookId}.`)
    }
    if (entry.book.edition_status !== 'family-supplied' && !/event:2026-\d\d-\d\d-\d{3}/.test(item.ownershipEvidence)) {
      throw new Error(`Для ${item.bookId} нужна отдельная запись о передаче полного PDF родителем.`)
    }
    const { book, index } = entry
    const published = await db.doc(`materialBooks/${book.id}`).get()
    if (published.data()?.sourceSha256 !== index.source_sha256) throw new Error(`Общий каталог для ${book.id} не синхронизирован.`)
    const destination = db.doc(`families/${familyId}/children/${childId}/books/${book.id}`)
    const current = await destination.get()
    if (current.exists && current.data()?.sourceSha256 !== item.sourceSha256) {
      throw new Error(`У ребёнка уже связана другая версия ${book.id}; нужна ручная сверка.`)
    }
    verified.push({ book, item, destination, bindingStatus,
      unchanged: current.data()?.status === bindingStatus && current.data()?.sourceSha256 === item.sourceSha256 })
  }
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ familyId, childId, verifiedBooks: verified.map(({ book, unchanged }) => ({ bookId: book.id, unchanged })), writes: 0 }, null, 2))
  } else {
    const batch = db.batch()
    const at = Timestamp.now()
    for (const { book, item, destination, bindingStatus, unchanged } of verified) {
      if (unchanged) continue
      batch.set(destination, {
      bookId: book.id, subjectKey: book.subject.toLocaleLowerCase('ru'),
      title: bookDisplayTitle(book), status: bindingStatus, sourceSha256: item.sourceSha256,
      evidence: { kind: 'legacy-family-full-pdf', ownershipEvidence: item.ownershipEvidence.trim(), sourceSha256: item.sourceSha256 },
      confirmedAt: at,
      }, { merge: true })
    }
    await batch.commit()
    console.log(JSON.stringify({ familyId, childId, linkedBooks: verified.filter((item) => !item.unchanged).map(({ book }) => book.id), unchangedBooks: verified.filter((item) => item.unchanged).map(({ book }) => book.id) }, null, 2))
  }
} else if (command === 'activate') {
  await childExists()
  const linked = await db.collection(`families/${familyId}/children/${childId}/books`).get()
  const confirmed = new Set(linked.docs.filter((item) => item.data().status === 'confirmed').map((item) => item.id))
  const referenced = new Set(Object.values(taskPageRefs()).flat().map((ref) => ref.slice(0, ref.lastIndexOf('#'))))
  const missing = [...referenced].filter((bookId) => !confirmed.has(bookId))
  if (missing.length) throw new Error(`Нельзя включить семейный барьер: не привязаны ${missing.join(', ')}.`)
  await db.doc(`families/${familyId}/children/${childId}`).update({ libraryPolicyVersion: 1, libraryPolicyActivatedAt: Timestamp.now() })
  console.log(JSON.stringify({ familyId, childId, libraryPolicyVersion: 1, referencedBooks: referenced.size }))
} else {
  throw new Error('Команды: inbox <familyId>; pull <familyId> <childId> <uploadId>; link <familyId> <childId> <uploadId> <bookId>; link-edition <familyId> <childId> <uploadId> <bookId> <evidence.json>; seed-existing <familyId> <childId>; activate <familyId> <childId>.')
}
