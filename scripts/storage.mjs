import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import readline from 'node:readline'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'
import { linksFile as pageLinksFile, materialLinks, pagesDir, preparePages } from '../storage/material-pages.mjs'
import { bookDisplayTitle, indexedBooks, pageDocument } from '../storage/textbook-catalog.mjs'
import { resolvedStoragePause } from '../storage/storage-pause.mjs'
import { materialPageDocument, needsPageWrite, selectPublicationPages } from '../storage/page-publication.mjs'

const local = resolve('.local')
const childLocal = resolve(process.env.EDUCATION_CHILD_WORKSPACE || '.local')
const tokenFile = resolve(local, 'yandex-disk-token')
const linksFile = resolve(childLocal, 'day-links.json')
const libraryManifestFile = resolve(local, 'yandex-pages/library.json')
const fullPageLinksFile = resolve(local, 'yandex-pages/full-book-links.json')
const [command, date] = process.argv.slice(2)

function fail(message) { throw new Error(message) }
function json(file) { return JSON.parse(readFileSync(file, 'utf8')) }
function prepareFirebaseLogin() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return
  const loginFile = resolve(local, 'config/configstore/firebase-tools.json')
  if (!existsSync(loginFile)) fail('Сначала войдите через Firebase CLI.')
  const login = json(loginFile)
  if (!login.tokens?.refresh_token) fail('Вход Firebase CLI устарел.')
  const require = createRequire(import.meta.url)
  const { clientId, clientSecret } = require('firebase-tools/lib/api')
  const file = resolve(local, 'adc.json')
  writeFileSync(file, JSON.stringify({ type: 'authorized_user', client_id: clientId(), client_secret: clientSecret(), refresh_token: login.tokens.refresh_token }), { mode: 0o600 })
  process.env.GOOGLE_APPLICATION_CREDENTIALS = file
}
function token() {
  const value = process.env.YANDEX_DISK_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '')
  if (!value) fail('Яндекс Диск не подключён. Выполните npm run storage -- connect.')
  return value
}
function firestore() {
  prepareFirebaseLogin()
  initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
  return getFirestore()
}

/** @see ../docs/product/materials.md#firestore-catalog */
async function syncCatalog() {
  const db = firestore()
  const books = indexedBooks()
  const known = existsSync(pageLinksFile) ? json(pageLinksFile) : {}
  const fullKnown = existsSync(fullPageLinksFile) ? json(fullPageLinksFile) : {}
  const selectedManifest = existsSync(resolve(pagesDir, 'manifest.json')) ? json(resolve(pagesDir, 'manifest.json')) : { entries: [] }
  const selectedById = new Map(selectedManifest.entries.map((entry) => [entry.id, entry]))
  const privateBooks = existsSync(libraryManifestFile) ? json(libraryManifestFile) : {}
  let count = 0, publishedCount = 0
  let batch = db.batch()
  for (const { book, index } of books) {
    batch.set(db.doc(`materialBooks/${book.id}`), {
      id: book.id, title: bookDisplayTitle(book), subject: book.subject, grade: book.grade, role: book.role,
      editionStatus: index.edition_status, sourceSha256: index.source_sha256,
      pdfPageCount: index.pdf_page_count, printedPageOffset: index.printed_page_offset,
      indexedAt: Timestamp.now(),
      ...(privateBooks[book.id]?.sourceSha256 === index.source_sha256
        ? { privateDiskPath: privateBooks[book.id].path } : {}),
    }, { merge: true })
    count += 1
    for (const page of index.pages) {
      const full = fullKnown[`${book.id}#${page.pdf_page}`]
      const selectedId = `${book.id}:${page.printed_page}`
      const selected = selectedById.get(selectedId)
      const published = full?.sourceSha256 === index.source_sha256 && full.publicUrl ? full
        : selected?.sourceSha256 === index.source_sha256 && selected.pdfPage === page.pdf_page
          && selected.imageSha256 === known[selectedId]?.imageSha256 ? known[selectedId] : null
      if (published) publishedCount += 1
      batch.set(db.doc(`materialBooks/${book.id}/pages/${page.pdf_page}`), {
        ...pageDocument(index, page),
        ...(published ? { title: published.title ?? `${bookDisplayTitle(book)}, стр. ${page.printed_page ?? page.pdf_page}`,
          url: published.publicUrl, imageSha256: published.imageSha256,
          diskPath: published.path ?? null, state: 'published' } : {}),
      }, { merge: true })
      count += 1
      if (count % 300 === 0) { await batch.commit(); batch = db.batch(); console.log(`Индекс Firestore: ${count} документов`) }
    }
  }
  if (count % 300) await batch.commit()
  const complete = db.batch()
  for (const { book, index } of books) complete.set(db.doc(`materialBooks/${book.id}`), {
    catalogIndexSha256: index.source_sha256, catalogPageCount: index.pdf_page_count,
    catalogCompletedAt: Timestamp.now(),
  }, { merge: true })
  await complete.commit()
  console.log(JSON.stringify({ books: books.length, pages: count - books.length, publishedPages: publishedCount }))
}

/** @see ../docs/product/materials.md#private-originals */
async function syncLibrary() {
  const storage = new YandexDiskStorage(token())
  mkdirSync(pagesDir, { recursive: true })
  const known = existsSync(libraryManifestFile) ? json(libraryManifestFile) : {}
  const books = indexedBooks()
  for (const { book, source, index } of books) {
    if (known[book.id]?.sourceSha256 === index.source_sha256) continue
    const path = `app:/PETR/Учебники/Оригиналы/${book.id}/${index.source_sha256.slice(0, 16)}.pdf`
    const result = await storage.putAt(path, readFileSync(source))
    known[book.id] = { path: result.path, sourceSha256: index.source_sha256, size: result.size, md5: result.md5 }
    writeFileSync(libraryManifestFile, `${JSON.stringify(known, null, 2)}\n`, { mode: 0o600 })
    console.log(`Оригинал на Диске: ${Object.keys(known).length}/${books.length} · ${book.id}`)
  }
  console.log(JSON.stringify({ storedOriginals: Object.keys(known).length }))
}
function hiddenInput(prompt) {
  if (!process.stdin.isTTY) fail('Подключение Диска запустите в интерактивном терминале.')
  return new Promise((resolveInput) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = function (value) { if (!this.muted) this.output.write(value) }
    rl.question(prompt, (value) => { rl.close(); process.stdout.write('\n'); resolveInput(value.trim()) })
    rl.muted = true
  })
}
function decodePhoto(dataUrl) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '')
  if (!match) return null
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length) return null
  return { bytes, extension: match[1] === 'jpeg' ? 'jpg' : match[1] }
}

async function connect() {
  console.log('Откройте ссылку авторизации своего приложения Яндекс OAuth и вставьте полученный токен. Ввод скрыт.')
  const value = await hiddenInput('OAuth-токен Яндекс Диска: ')
  if (!value) fail('Пустой токен не сохранён.')
  const storage = new YandexDiskStorage(value)
  await storage.ensureFolder('app:/PETR')
  mkdirSync(local, { recursive: true })
  writeFileSync(tokenFile, `${value}\n`, { mode: 0o600 })
  console.log('Яндекс Диск подключён. Проверена запись в закрытую папку приложения app:/PETR.')
}

/** @see ../docs/product/storage-privacy.md#storage-migration */
async function sync() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) fail('Укажите дату YYYY-MM-DD.')
  const student = json(linksFile)[date]?.student
  if (!student) fail('Для даты ещё нет страницы дня.')
  const storage = new YandexDiskStorage(token())
  prepareFirebaseLogin()
  initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
  const db = getFirestore()
  const snapshot = await db.collection(`dayUploads/${student}/files`).get()
  let stored = 0
  let verified = 0
  let cleaned = 0
  let deleted = 0
  let storagePausesCleared = 0
  const failures = []
  const activePaths = new Set(snapshot.docs.filter((item) => item.data().status !== 'deleted')
    .map((item) => item.data().storage?.path).filter(Boolean))
  if (snapshot.docs.some((item) => item.data().status === 'deleted' && item.data().storage?.path)) {
    const owners = await db.collection('dayOwners').get()
    for (const owner of owners.docs) {
      if (owner.id === student) continue
      const otherFiles = await db.collection(`dayUploads/${owner.id}/files`).get()
      for (const other of otherFiles.docs) {
        const data = other.data()
        if (data.status !== 'deleted' && data.storage?.path) activePaths.add(data.storage.path)
      }
    }
  }
  for (const item of snapshot.docs) {
    const upload = item.data()
    if (upload.status === 'deleted') {
      try {
        if (upload.storage?.path && !activePaths.has(upload.storage.path)) {
          await storage.removeWorkAt(upload.storage.path, upload.storage.md5)
        }
        await item.ref.delete()
        deleted += 1
      } catch (error) {
        failures.push(`${item.id}: не удалось удалить фото с Диска: ${error.message}`)
      }
      continue
    }
    const photo = decodePhoto(upload.dataUrl)
    const onDisk = upload.storage?.provider === 'yandex-disk' && upload.storage?.state === 'stored' && upload.storage?.publicUrl
    if (!photo && !onDisk) { failures.push(`${item.id}: нет изображения или проверенной ссылки на Диск`); continue }
    try {
      if (onDisk) {
        const remote = await storage.head(upload.storage.path)
        if (remote?.type !== 'file' || remote.size !== upload.storage.size || !remote.md5
          || (upload.storage.md5 && remote.md5.toLowerCase() !== upload.storage.md5.toLowerCase())) {
          throw new Error('файл на Диске не совпадает с сохранённой записью')
        }
        if (photo) {
          const md5 = createHash('md5').update(photo.bytes).digest('hex')
          storage.verify(remote, photo.bytes, md5, upload.storage.path)
          if (upload.storage.sha256 && createHash('sha256').update(photo.bytes).digest('hex') !== upload.storage.sha256) throw new Error('локальное фото не совпадает с архивной записью')
          await item.ref.update({ dataUrl: FieldValue.delete(), originalName: FieldValue.delete() })
          cleaned += 1
        } else verified += 1
        continue
      }
      const sha256 = createHash('sha256').update(photo.bytes).digest('hex')
      const md5 = createHash('md5').update(photo.bytes).digest('hex')
      const subject = { en: 'Английский', math: 'Математика', ru: 'Русский-язык', sp: 'Спецкурс' }[upload.taskId?.split('-')[0]] ?? 'Прочее'
      const path = upload.storage?.path ?? `app:/PETR/Работы/${date}/${subject}/${student}-${item.id}.${photo.extension}`
      const result = await storage.putAt(path, photo.bytes, md5)
      const publicUrl = await storage.publish(path)
      const remote = await storage.head(path)
      if (!remote?.md5) throw new Error('Диск ещё не подтвердил контрольную сумму; повторите синхронизацию')
      storage.verify(remote, photo.bytes, md5, path)
      await item.ref.update({
        storage: { ...result, state: 'stored', sha256, publicUrl, syncedAt: Timestamp.now() },
        dataUrl: FieldValue.delete(), originalName: FieldValue.delete(),
      })
      stored += 1
      cleaned += 1
      console.log(`Сохранено на Диске: ${stored}/${snapshot.size}`)
    } catch (error) {
      failures.push(`${item.id}: ${error.message}`)
    }
  }
  for (const taskId of new Set(snapshot.docs.map((item) => item.data().taskId).filter(Boolean))) {
    const reviewRef = db.doc(`dayProgress/${student}/items/${taskId}`)
    try {
      const cleared = await db.runTransaction(async (transaction) => {
        const review = (await transaction.get(reviewRef)).data()
        const processing = review?.processing
        if (processing?.phase !== 'paused' || !Array.isArray(processing.uploadIds) || !processing.uploadIds.length) return false
        const refs = processing.uploadIds.map((id) => db.doc(`dayUploads/${student}/files/${id}`))
        const photos = await transaction.getAll(...refs)
        const uploads = new Map(photos.map((photo) => [photo.id, photo.data()]))
        if (!resolvedStoragePause(processing, uploads)) return false
        transaction.update(reviewRef, { processing: FieldValue.delete() })
        return true
      })
      if (cleared) storagePausesCleared += 1
    } catch (error) {
      failures.push(`${taskId}: не удалось обновить статус после переноса: ${error.message}`)
    }
  }
  console.log(JSON.stringify({ date, total: snapshot.size, stored, verified, deleted, firestoreCopiesRemoved: cleaned, storagePausesCleared, failed: failures.length }, null, 2))
  if (failures.length) fail(`Не удалось перенести ${failures.length} вложений: ${failures.join('; ')}`)
}

/** @see ../docs/product/materials.md#page-publication */
async function syncPages() {
  const allEntries = preparePages()
  const pageId = date === '--page' ? process.argv[4] : undefined
  if (date && (date !== '--page' || !pageId || process.argv.length !== 5)) fail('sync-pages [--page bookId:printedPage]')
  const entries = selectPublicationPages(allEntries, pageId)
  const storage = new YandexDiskStorage(token())
  const known = existsSync(pageLinksFile) ? json(pageLinksFile) : {}
  const failures = []
  let published = 0
  for (const entry of entries) {
    if (known[entry.id]?.publicUrl && known[entry.id]?.imageSha256 === entry.imageSha256) continue
    try {
      const bytes = readFileSync(entry.image)
      const result = await storage.putAt(entry.diskPath, bytes)
      const publicUrl = await storage.publish(result.path)
      known[entry.id] = { title: entry.title, publicUrl, path: result.path, imageSha256: entry.imageSha256 }
      writeFileSync(pageLinksFile, `${JSON.stringify(known, null, 2)}\n`, { mode: 0o600 })
      published += 1
      console.log(`Страница на Диске: ${published}/${entries.length} · ${entry.title}`)
    } catch (error) {
      failures.push(`${entry.id}: ${error.message}`)
    }
  }
  if (failures.length) fail(`Не удалось опубликовать ${failures.length} страниц: ${failures.join('; ')}`)
  const db = firestore()
  let catalogWrites = 0, catalogReadbacks = 0
  for (let offset = 0; offset < entries.length; offset += 300) {
    const batch = db.batch()
    const group = entries.slice(offset, offset + 300)
    const snapshots = await db.getAll(...group.map((entry) => db.doc(`materialBooks/${entry.bookId}/pages/${entry.pdfPage}`)))
    const changes = []
    for (const [index, entry] of group.entries()) {
      const link = known[entry.id]
      const desired = materialPageDocument(entry, link.publicUrl)
      if (!needsPageWrite(snapshots[index].data(), desired)) continue
      batch.set(snapshots[index].ref, desired, { merge: true })
      changes.push({ ref: snapshots[index].ref, desired })
    }
    if (changes.length) {
      await batch.commit()
      const readback = await db.getAll(...changes.map((item) => item.ref))
      if (readback.some((snapshot, index) => needsPageWrite(snapshot.data(), changes[index].desired))) fail('Каталог страницы не подтвердился после публикации.')
      catalogWrites += changes.length
      catalogReadbacks += readback.length
    }
  }
  const links = materialLinks(known)
  const index = ['# Страницы материалов на Яндекс.Диске', '', 'Ссылки относятся к отдельным изображениям, а не к полным PDF.', '']
  for (const entry of allEntries) {
    const url = known[entry.id]?.publicUrl
    if (url) index.push(`- [${entry.title}](${url})`)
  }
  writeFileSync(resolve(pagesDir, 'index.md'), `${index.join('\n')}\n`, { mode: 0o600 })
  if (!pageId && Object.values(links).some((items) => items.length)) {
    const batch = db.batch()
    let changedPages = 0
    for (const pair of Object.values(json(linksFile))) {
      for (const dayToken of [pair.student, pair.parent]) {
        const ref = db.doc(`dayPages/${dayToken}`)
        const snapshot = await ref.get()
        if (!snapshot.exists) continue
        const page = snapshot.data()
        const materialLinks = Object.fromEntries(Object.entries(page.materialLinks || {}).map(([taskId, items]) => [taskId, items.map(({ siteImage, siteThumbnail, ...link }) => link)]))
        let changed = JSON.stringify(materialLinks) !== JSON.stringify(page.materialLinks || {})
        for (const [taskId, newLinks] of Object.entries(links)) {
          if (!page.taskIds?.includes(taskId) || !newLinks.length) continue
          const merged = [...new Map([...(materialLinks[taskId] || []), ...newLinks].map((item) => [item.url, item])).values()]
          if (JSON.stringify(merged) !== JSON.stringify(materialLinks[taskId] || [])) {
            materialLinks[taskId] = merged
            changed = true
          }
        }
        if (changed) { batch.update(ref, { materialLinks }); changedPages += 1 }
      }
    }
    if (changedPages) await batch.commit()
    console.log(`Обновлено страниц Education: ${changedPages}`)
  }
  console.log(JSON.stringify({ pages: entries.length, published, failed: failures.length,
    catalogReads: entries.length, catalogWrites, catalogReadbacks, dayLinks: pageId ? 'publish-through-day-command' : 'reconciled' }, null, 2))
}

/** Publish every page of editions explicitly linked to a family. The local
 * checkpoint makes a long manual sync safe to resume after a network failure.
 * @see ../docs/product/family-library.md#full-book-reader
 */
async function syncFamilyPages() {
  const db = firestore()
  const indexed = new Map(indexedBooks().map((entry) => [entry.book.id, entry]))
  const bindings = await db.collectionGroup('books').get()
  const byBook = new Map()
  for (const doc of bindings.docs) {
    const child = doc.ref.parent.parent
    const family = child?.parent.parent
    if (!child || !family || family.parent.id !== 'families') continue
    const data = doc.data()
    if (!['confirmed', 'provisional'].includes(data.status)) continue
    const entry = indexed.get(doc.id)
    if (!entry || (data.catalogSha256 ?? data.sourceSha256) !== entry.index.source_sha256) {
      throw new Error(`Семейная связь ${doc.ref.path} не соответствует индексированному оригиналу PDF.`)
    }
    if (!byBook.has(doc.id)) byBook.set(doc.id, { entry, bindings: [] })
    byBook.get(doc.id).bindings.push({ ref: doc.ref, data })
  }
  const disk = new YandexDiskStorage(token())
  const known = existsSync(fullPageLinksFile) ? json(fullPageLinksFile) : {}
  const selected = existsSync(pageLinksFile) ? json(pageLinksFile) : {}
  const selectedManifest = existsSync(resolve(pagesDir, 'manifest.json')) ? json(resolve(pagesDir, 'manifest.json')) : { entries: [] }
  const selectedById = new Map(selectedManifest.entries.map((entry) => [entry.id, entry]))
  let published = 0, projected = 0
  for (const [bookId, { entry, bindings }] of [...byBook].sort(([a], [b]) => a.localeCompare(b))) {
    const { book, source, index } = entry
    const familyBindings = []
    for (const binding of bindings) {
      const pages = await binding.ref.parent.parent.collection('bookPages').where('bookId', '==', bookId).count().get()
      if (binding.data.pdfPageCount !== index.pdf_page_count
        || binding.data.pagesPublishedSha256 !== index.source_sha256 || !binding.data.pagesPublishedAt
        || pages.data().count !== index.pdf_page_count) familyBindings.push(binding)
    }
    if (!familyBindings.length) { console.log(`${bookId}: семейные страницы уже опубликованы`); continue }
    const catalog = await db.doc(`materialBooks/${bookId}`).get()
    if (catalog.data()?.sourceSha256 !== index.source_sha256) {
      throw new Error(`Сначала синхронизируйте общий каталог: ${bookId}.`)
    }
    const sharedSnapshot = await db.collection(`materialBooks/${bookId}/pages`).get()
    const shared = new Map(sharedSnapshot.docs.map((page) => [Number(page.id), page.data()]))
    const initial = db.batch()
    for (const { ref: binding } of familyBindings) initial.set(binding, { pdfPageCount: index.pdf_page_count }, { merge: true })
    await initial.commit()
    for (const folder of ['app:/PETR', 'app:/PETR/Учебники', `app:/PETR/Учебники/${bookId}`,
      `app:/PETR/Учебники/${bookId}/${index.source_sha256.slice(0, 12)}-r160`]) await disk.ensureFolder(folder)
    async function publishPage(page) {
      const ref = `${bookId}#${page.pdf_page}`
      const current = shared.get(page.pdf_page)
      let publishedPage = current?.state === 'published' && current.sourceSha256 === index.source_sha256
        && typeof current.url === 'string' && current.url.startsWith('https://') && typeof current.imageSha256 === 'string'
        ? { publicUrl: current.url, imageSha256: current.imageSha256, path: current.diskPath } : null
      if (!publishedPage && known[ref]?.sourceSha256 === index.source_sha256) publishedPage = known[ref]
      const selectedId = `${bookId}:${page.printed_page}`
      const selectedEntry = selectedById.get(selectedId)
      if (!publishedPage && selectedEntry?.pdfPage === page.pdf_page
        && selectedEntry.sourceSha256 === index.source_sha256
        && selected[selectedId]?.imageSha256 === selectedEntry.imageSha256
        && selected[selectedId]?.publicUrl) publishedPage = selected[selectedId]
      if (!publishedPage) {
        const filename = `pdf-${String(page.pdf_page).padStart(4, '0')}.png`
        const image = resolve(pagesDir, 'full', bookId, filename)
        mkdirSync(resolve(pagesDir, 'full', bookId), { recursive: true })
        execFileSync('pdftoppm', ['-f', String(page.pdf_page), '-l', String(page.pdf_page), '-r', '160', '-png', '-singlefile', source, image.slice(0, -4)], { stdio: 'ignore' })
        const bytes = readFileSync(image)
        const imageSha256 = createHash('sha256').update(bytes).digest('hex')
        const path = `app:/PETR/Учебники/${bookId}/${index.source_sha256.slice(0, 12)}-r160/${filename}`
        const uploaded = await disk.putAt(path, bytes)
        const publicUrl = await disk.publish(uploaded.path)
        publishedPage = { publicUrl, imageSha256, path, sourceSha256: index.source_sha256 }
        known[ref] = publishedPage
        const temporary = `${fullPageLinksFile}.tmp`
        writeFileSync(temporary, `${JSON.stringify(known, null, 2)}\n`, { mode: 0o600 })
        renameSync(temporary, fullPageLinksFile)
        unlinkSync(image)
        published += 1
      }
      const title = `${bookDisplayTitle(book)}, ${page.printed_page == null ? `PDF-страница ${page.pdf_page}` : `стр. ${page.printed_page}`}`
      const pageData = { bookId, pdfPage: page.pdf_page, printedPage: page.printed_page ?? null,
        subject: book.subject, title, sourceRef: page.source_ref, sourceSha256: index.source_sha256,
        editionStatus: index.edition_status, extraction: page.extraction, imageSha256: publishedPage.imageSha256,
        state: 'published', url: publishedPage.publicUrl, updatedAt: Timestamp.now() }
      return { ref, pageData, diskPath: publishedPage.path ?? null }
    }
    const chunkSize = 12
    for (let offset = 0; offset < index.pages.length; offset += chunkSize) {
      const results = await Promise.allSettled(index.pages.slice(offset, offset + chunkSize).map(publishPage))
      let batch = db.batch(), writes = 0
      async function queue(ref, data) {
        batch.set(ref, data, { merge: true })
        writes += 1
        if (writes >= 240) { await batch.commit(); batch = db.batch(); writes = 0 }
      }
      for (const result of results) {
        if (result.status !== 'fulfilled') continue
        const { ref, pageData, diskPath } = result.value
        await queue(db.doc(`materialBooks/${bookId}/pages/${pageData.pdfPage}`), { ...pageData, diskPath })
        for (const { ref: binding } of familyBindings) await queue(binding.parent.parent.collection('bookPages').doc(ref), pageData)
      }
      if (writes) await batch.commit()
      const failed = results.flatMap((result, indexInChunk) => result.status === 'rejected'
        ? [{ pdfPage: index.pages[offset + indexInChunk].pdf_page, reason: result.reason }] : [])
      console.log(`${bookId}: ${Math.min(offset + chunkSize, index.pdf_page_count)}/${index.pdf_page_count} страниц; ошибок ${failed.length}`)
      if (failed.length) throw new Error(`${bookId}, PDF-страница ${failed[0].pdfPage}: ${failed[0].reason?.message ?? failed[0].reason}. Повторите команду.`)
    }
    const complete = db.batch()
    for (const { ref: binding } of familyBindings) {
      const pages = await binding.parent.parent.collection('bookPages').where('bookId', '==', bookId).count().get()
      if (pages.data().count !== index.pdf_page_count) throw new Error(`${binding.path}: опубликовано ${pages.data().count} из ${index.pdf_page_count} страниц.`)
      complete.set(binding, { pdfPageCount: index.pdf_page_count,
        pagesPublishedSha256: index.source_sha256, pagesPublishedAt: Timestamp.now() }, { merge: true })
    }
    await complete.commit()
    projected += index.pdf_page_count * familyBindings.length
    console.log(`${bookId}: готово ${index.pdf_page_count} страниц для ${familyBindings.length} семейных связей`)
  }
  console.log(JSON.stringify({ books: byBook.size, newlyPublished: published, familyPagesProjected: projected }))
}

/** Preserve image attachments from MESH as viewable Education materials. */
async function syncTeacher() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) fail('Укажите дату задания YYYY-MM-DD.')
  const folder = resolve(childLocal, 'diary', 'files', date)
  const manifestFile = resolve(folder, 'manifest.json')
  if (!existsSync(manifestFile)) fail(`Сначала скачайте вложения МЭШ на ${date}.`)
  const archivedFile = resolve(folder, 'yandex-links.json')
  const archived = existsSync(archivedFile) ? json(archivedFile) : {}
  const storage = new YandexDiskStorage(token())
  let published = 0
  for (const item of Object.values(json(manifestFile))) {
    if (item.scope !== 'homework') continue
    const isImage = /^image\/(png|jpeg|webp)$/.test(item.contentType ?? '')
    const isPdf = item.contentType === 'application/pdf'
    if (!isImage && !isPdf) continue
    if (!/^\d+$/.test(String(item.id ?? '')) || !/^[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|pdf)$/.test(item.file ?? '')) fail('Некорректное имя файла вложения МЭШ.')
    const bytes = readFileSync(resolve(folder, item.file))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== item.sha256 || bytes.length !== item.size) fail(`Вложение МЭШ ${item.id} не совпадает со скачанным оригиналом.`)
    if (archived[item.id]?.sha256 === sha256 && (archived[item.id]?.publicUrl || archived[item.id]?.pages?.length)) continue
    if (isPdf) {
      const privatePath = `app:/PETR/Материалы/МЭШ/${date}/${item.id}-${sha256.slice(0, 16)}.pdf`
      await storage.putAt(privatePath, bytes)
      const info = execFileSync('pdfinfo', [resolve(folder, item.file)], { encoding: 'utf8' })
      const pageCount = Number(/^Pages:\s+(\d+)$/m.exec(info)?.[1])
      if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 30) fail(`PDF учителя ${item.id}: неподдерживаемое число страниц.`)
      const renderDir = resolve(folder, `rendered-${item.id}`)
      mkdirSync(renderDir, { recursive: true, mode: 0o700 })
      const prefix = resolve(renderDir, 'page')
      execFileSync('pdftoppm', ['-f', '1', '-l', String(pageCount), '-r', '160', '-png', resolve(folder, item.file), prefix])
      const pages = []
      for (let number = 1; number <= pageCount; number += 1) {
        const image = readFileSync(`${prefix}-${number}.png`)
        const imageSha256 = createHash('sha256').update(image).digest('hex')
        const diskPath = `app:/PETR/Материалы/МЭШ/${date}/${item.id}-${sha256.slice(0, 16)}-page-${number}.png`
        await storage.putAt(diskPath, image)
        const publicUrl = await storage.publish(diskPath)
        pages.push({ number, publicUrl, diskPath, sha256: imageSha256 })
        published += 1
      }
      archived[item.id] = { title: item.title, sourceUrl: item.url, sourceItemId: item.sourceItemId, privatePath, sha256, pages, publishedAt: new Date().toISOString() }
      writeFileSync(archivedFile, `${JSON.stringify(archived, null, 2)}\n`, { mode: 0o600 })
      continue
    }
    const extension = item.contentType === 'image/jpeg' ? 'jpg' : item.contentType.split('/')[1]
    const diskPath = `app:/PETR/Материалы/МЭШ/${date}/${item.id}-${sha256.slice(0, 16)}.${extension}`
    const result = await storage.putAt(diskPath, bytes)
    const publicUrl = await storage.publish(result.path)
    const remote = await storage.head(diskPath)
    storage.verify(remote, bytes, createHash('md5').update(bytes).digest('hex'), diskPath)
    archived[item.id] = { title: item.title, publicUrl, diskPath, sha256, sourceUrl: item.url, sourceItemId: item.sourceItemId, publishedAt: new Date().toISOString() }
    writeFileSync(archivedFile, `${JSON.stringify(archived, null, 2)}\n`, { mode: 0o600 })
    published += 1
  }
  console.log(JSON.stringify({ date, imageAttachments: Object.keys(archived).length, published }, null, 2))
}

if (command === 'connect') await connect()
else if (command === 'sync') await sync()
else if (command === 'sync-teacher') await syncTeacher()
else if (command === 'prepare-pages') console.log(JSON.stringify({ prepared: preparePages().length, directory: '.local/yandex-pages' }))
else if (command === 'sync-pages') await syncPages()
else if (command === 'sync-catalog') await syncCatalog()
else if (command === 'sync-family-pages') await syncFamilyPages()
else if (command === 'sync-library') await syncLibrary()
else fail('Команды: connect | sync YYYY-MM-DD | sync-teacher YYYY-MM-DD | prepare-pages | sync-pages | sync-catalog | sync-library | sync-family-pages')
