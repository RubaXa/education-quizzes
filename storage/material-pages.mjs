import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { indexedBooks } from './textbook-catalog.mjs'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const planFile = resolve(projectRoot, 'education-quizzes/.local/material-pages.json')
export const materialPlan = existsSync(planFile)
  ? JSON.parse(readFileSync(planFile, 'utf8'))
  : { books: [], taskPages: {}, taskEvidence: {} }
export const pagesDir = resolve(projectRoot, 'education-quizzes/.local/yandex-pages')
export const manifestFile = resolve(pagesDir, 'manifest.json')
export const linksFile = resolve(pagesDir, 'links.json')

function booksById() {
  const books = new Map(indexedBooks().map(({ book, source, index }) => [book.id, {
    id: book.id,
    title: `${book.subject} ${book.grade}${/part-?(\d)/.test(book.id) ? ` · часть ${/part-?(\d)/.exec(book.id)[1]}` : ''} · ${book.id.match(/\d{4}$/)?.[0] || 'учебник'}`,
    source,
    folder: book.id, pdfPageOffset: -index.printed_page_offset,
    index, sourceType: 'textbook-page',
  }]))
  for (const book of materialPlan.books) {
    const indexed = books.get(book.id)
    books.set(book.id, { ...indexed, ...book, source: indexed?.source || resolve(projectRoot, 'education-quizzes', book.source) })
  }
  return books
}

function selectedPages(books) {
  const selected = new Map([...books].map(([id, book]) => [id, new Set(book.pages || [])]))
  for (const ids of Object.values(materialPlan.taskPages)) for (const id of ids) {
    const separator = id.lastIndexOf(':')
    const bookId = id.slice(0, separator)
    const printedPage = Number(id.slice(separator + 1))
    if (!books.has(bookId) || !Number.isInteger(printedPage)) throw new Error(`Некорректная страница ${id}`)
    selected.get(bookId).add(printedPage)
  }
  return selected
}

/** @see ../docs/product/materials.md#firestore-catalog */
export function taskPageRefs() {
  const books = booksById()
  return Object.fromEntries(Object.entries(materialPlan.taskPages).map(([taskId, ids]) => [taskId, ids.map((id) => {
    const separator = id.lastIndexOf(':')
    const book = books.get(id.slice(0, separator))
    const printedPage = Number(id.slice(separator + 1))
    if (!book || !Number.isInteger(printedPage)) throw new Error(`Некорректная страница ${id}`)
    const page = book.index?.pages.find((item) => item.printed_page === printedPage)
    if (book.index && !page) throw new Error(`В индексе ${book.id} нет печатной страницы ${printedPage}`)
    return `${book.id}#${page?.pdf_page ?? printedPage + book.pdfPageOffset}`
  })]))
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function pdfPageCount(file) {
  const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' })
  const match = /^Pages:\s+(\d+)/m.exec(info)
  if (!match) throw new Error(`Не удалось прочитать число страниц: ${file}`)
  return Number(match[1])
}

/** @see ../docs/product/materials.md#page-publication */
export function preparePages() {
  const books = booksById()
  if (!books.size) throw new Error('Каталог учебников пуст.')
  const selected = selectedPages(books)
  mkdirSync(pagesDir, { recursive: true })
  const previous = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')).entries : []
  const previousById = new Map(previous.map((entry) => [entry.id, entry]))
  const entries = []
  for (const book of books.values()) {
    if (!selected.get(book.id)?.size) continue
    const source = book.source
    const sourceSha256 = book.index?.source_sha256 ?? digest(readFileSync(source))
    const count = book.index?.pdf_page_count ?? pdfPageCount(source)
    const outputDir = resolve(pagesDir, book.id)
    mkdirSync(outputDir, { recursive: true })
    for (const printedPage of [...selected.get(book.id)].sort((a, b) => a - b)) {
      const indexedPage = book.index?.pages.find((item) => item.printed_page === printedPage)
      if (book.index && !indexedPage) throw new Error(`В индексе ${book.id} нет печатной страницы ${printedPage}`)
      const pdfPage = indexedPage?.pdf_page ?? printedPage + book.pdfPageOffset
      if (pdfPage < 1 || pdfPage > count) throw new Error(`Страница ${printedPage} вышла за границы PDF ${book.id}.`)
      const filename = `стр-${String(printedPage).padStart(4, '0')}.png`
      const image = resolve(outputDir, filename)
      const outputBase = image.slice(0, -4)
      const id = `${book.id}:${printedPage}`
      if (!existsSync(image) || previousById.get(id)?.sourceSha256 !== sourceSha256) execFileSync('pdftoppm', ['-f', String(pdfPage), '-l', String(pdfPage), '-r', '160', '-png', '-singlefile', source, outputBase], { stdio: 'ignore' })
      const bytes = readFileSync(image)
      const imageSha256 = digest(bytes)
      entries.push({
        id, bookId: book.id, title: `${book.title}, стр. ${printedPage}`,
        printedPage, pdfPage, sourceSha256, imageSha256, image,
        diskPath: `app:/PETR/Учебники/${book.folder}/${sourceSha256.slice(0, 12)}-r160/${filename}`,
        size: bytes.length,
      })
    }
  }
  writeFileSync(manifestFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2)}\n`, { mode: 0o600 })
  return entries
}

/** @see ../docs/product/materials.md#source-metadata */
export function materialLinks(linkMap) {
  const bookById = booksById()
  const indexCache = new Map()
  const manifestEntries = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')).entries : []
  const manifestById = new Map(manifestEntries.map((entry) => [entry.id, entry]))
  for (const [taskId, evidence] of Object.entries(materialPlan.taskEvidence || {})) {
    if (!materialPlan.taskPages[taskId]?.includes(evidence.pageId)) throw new Error(`Цитата ${taskId} не связана с заданной страницей ${evidence.pageId}`)
  }
  function pageMetadata(book, printedPage, evidence) {
    if (book.sourceType === 'teacher-attachment') return {}
    if (!indexCache.has(book.id)) {
      const source = book.source
      const index = book.index || JSON.parse(readFileSync(resolve(source, '../../search-index.json'), 'utf8'))
      if (resolve(projectRoot, index.source_pdf) !== source || index.source_sha256 !== digest(readFileSync(source))) {
        throw new Error(`Поисковый индекс ${book.id} не соответствует оригиналу PDF. Запустите python3 tools/textbook_index.py build-all.`)
      }
      indexCache.set(book.id, index)
    }
    const index = indexCache.get(book.id)
    const page = index.pages.find((item) => item.printed_page === printedPage)
    if (!page || page.pdf_page !== printedPage + book.pdfPageOffset) throw new Error(`Неверная печатная/PDF страница ${book.id}:${printedPage}`)
    if (evidence) {
      const flat = (value) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru')
      if (!flat(page.text).includes(flat(evidence.quote))) throw new Error(`Цитата не найдена на странице ${book.id}:${printedPage}`)
    }
    return { sourceRef: page.source_ref, pdfPage: page.pdf_page, printedPage: page.printed_page, editionStatus: index.edition_status, extraction: page.extraction, sourceSha256: index.source_sha256, ...(evidence ? { sourceQuote: evidence.quote } : {}) }
  }
  return Object.fromEntries(Object.entries(materialPlan.taskPages).map(([taskId, pageIds]) => [taskId, pageIds.map((id) => {
    const separator = id.lastIndexOf(':')
    const book = bookById.get(id.slice(0, separator))
    if (!book) throw new Error(`Неизвестная книга в привязке ${id}`)
    const printedPage = Number(id.slice(separator + 1))
    const link = linkMap[id]
    const prepared = manifestById.get(id)
    if (link?.publicUrl && (!prepared || link.imageSha256 !== prepared.imageSha256)) throw new Error(`Опубликованная страница ${id} не совпадает с локальным изображением из PDF`)
    const evidence = materialPlan.taskEvidence?.[taskId]
    if (!link?.publicUrl) return null
    const metadata = pageMetadata(book, printedPage, evidence?.pageId === id ? evidence : null)
    if (metadata.sourceSha256 && prepared.sourceSha256 !== metadata.sourceSha256) throw new Error(`Изображение ${id} получено из другой версии PDF`)
    return { title: link.title, url: link.publicUrl, sourceType: book.sourceType || 'textbook-page', ...metadata }
  }).filter(Boolean)]))
}
