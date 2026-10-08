import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import readline from 'node:readline'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'
import { linksFile as pageLinksFile, materialLinks, pagesDir, preparePages } from '../storage/material-pages.mjs'
import { indexedBooks, pageDocument } from '../storage/textbook-catalog.mjs'

const local = resolve('.local')
const tokenFile = resolve(local, 'yandex-disk-token')
const linksFile = resolve(local, 'day-links.json')
const libraryManifestFile = resolve(local, 'yandex-pages/library.json')
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
  const privateBooks = existsSync(libraryManifestFile) ? json(libraryManifestFile) : {}
  let count = 0
  let batch = db.batch()
  for (const { book, index } of books) {
    batch.set(db.doc(`materialBooks/${book.id}`), {
      id: book.id, subject: book.subject, grade: book.grade, role: book.role,
      editionStatus: index.edition_status, sourceSha256: index.source_sha256,
      pdfPageCount: index.pdf_page_count, printedPageOffset: index.printed_page_offset,
      indexedAt: Timestamp.now(),
      ...(privateBooks[book.id]?.sourceSha256 === index.source_sha256
        ? { privateDiskPath: privateBooks[book.id].path } : {}),
    }, { merge: true })
    count += 1
    for (const page of index.pages) {
      const published = known[`${book.id}:${page.printed_page}`]
      batch.set(db.doc(`materialBooks/${book.id}/pages/${page.pdf_page}`), {
        ...pageDocument(index, page),
        ...(published ? { title: published.title, url: published.publicUrl,
          imageSha256: published.imageSha256, state: 'published' } : {}),
      }, { merge: true })
      count += 1
      if (count % 300 === 0) { await batch.commit(); batch = db.batch(); console.log(`Индекс Firestore: ${count} документов`) }
    }
  }
  if (count % 300) await batch.commit()
  console.log(JSON.stringify({ books: books.length, pages: count - books.length, publishedPages: Object.keys(known).length }))
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
  const failures = []
  for (const item of snapshot.docs) {
    const upload = item.data()
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
      const path = upload.storage?.path ?? `app:/PETR/Работы/${date}/${subject}/${sha256}.${photo.extension}`
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
  console.log(JSON.stringify({ date, total: snapshot.size, stored, verified, firestoreCopiesRemoved: cleaned, failed: failures.length }, null, 2))
  if (failures.length) fail(`Не удалось перенести ${failures.length} вложений: ${failures.join('; ')}`)
}

/** @see ../docs/product/materials.md#page-publication */
async function syncPages() {
  const entries = preparePages()
  const storage = new YandexDiskStorage(token())
  const known = existsSync(pageLinksFile) ? json(pageLinksFile) : {}
  const failures = []
  let published = 0
  for (const entry of entries) {
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
  for (let offset = 0; offset < entries.length; offset += 300) {
    const batch = db.batch()
    for (const entry of entries.slice(offset, offset + 300)) {
      const link = known[entry.id]
      batch.set(db.doc(`materialBooks/${entry.bookId}/pages/${entry.pdfPage}`), {
        bookId: entry.bookId, title: entry.title, pdfPage: entry.pdfPage,
        printedPage: entry.printedPage, sourceSha256: entry.sourceSha256,
        imageSha256: entry.imageSha256, diskPath: entry.diskPath,
        url: link.publicUrl, state: 'published',
      }, { merge: true })
    }
    await batch.commit()
  }
  const links = materialLinks(known)
  const index = ['# Страницы материалов на Яндекс.Диске', '', 'Ссылки относятся к отдельным изображениям, а не к полным PDF.', '']
  for (const entry of entries) {
    const url = known[entry.id]?.publicUrl
    if (url) index.push(`- [${entry.title}](${url})`)
  }
  writeFileSync(resolve(pagesDir, 'index.md'), `${index.join('\n')}\n`, { mode: 0o600 })
  if (Object.values(links).some((items) => items.length)) {
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
  console.log(JSON.stringify({ pages: entries.length, published, failed: failures.length }, null, 2))
}

if (command === 'connect') await connect()
else if (command === 'sync') await sync()
else if (command === 'prepare-pages') console.log(JSON.stringify({ prepared: preparePages().length, directory: '.local/yandex-pages' }))
else if (command === 'sync-pages') await syncPages()
else if (command === 'sync-catalog') await syncCatalog()
else if (command === 'sync-library') await syncLibrary()
else fail('Команды: connect | sync YYYY-MM-DD | prepare-pages | sync-pages | sync-catalog | sync-library')
