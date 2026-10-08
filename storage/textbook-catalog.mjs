import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const registryFile = resolve(root, 'library/textbooks/registry.json')

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }

/**
 * The local search index supplies page identity; Firestore stores the shared catalog.
 * A page's public URL is added only after its exact PNG is checked on Yandex Disk.
 * @see ../docs/product/materials.md#firestore-catalog
 */
export function indexedBooks() {
  const registry = JSON.parse(readFileSync(registryFile, 'utf8'))
  return registry.books.filter((book) => book.role === 'student-textbook').map((book) => {
    const source = resolve(root, book.pdf)
    const index = JSON.parse(readFileSync(resolve(source, '../../search-index.json'), 'utf8'))
    if (index.book_id !== book.id || index.source_sha256 !== sha256(readFileSync(source))
      || resolve(root, index.source_pdf) !== source || index.pages.length !== index.pdf_page_count) {
      throw new Error(`Индекс учебника ${book.id} не соответствует PDF.`)
    }
    return { book, source, index }
  })
}

export function pageDocument(index, page) {
  return {
    bookId: index.book_id,
    subject: index.subject,
    pdfPage: page.pdf_page,
    printedPage: page.printed_page ?? null,
    sourceRef: page.source_ref,
    extraction: page.extraction,
    sourceSha256: index.source_sha256,
    editionStatus: index.edition_status,
    searchText: page.text ?? '',
  }
}

export function pageRef(bookId, pdfPage) { return `${bookId}#${pdfPage}` }

export function parsePageRef(value) {
  const match = /^([a-z0-9-]+)#([1-9]\d*)$/.exec(value ?? '')
  if (!match) throw new Error(`Некорректный ID страницы: ${value}`)
  return { bookId: match[1], pdfPage: Number(match[2]) }
}
