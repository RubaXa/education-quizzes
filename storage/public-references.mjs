/** @see ../docs/modules/materials/materials.md#public-references */
/** @see ../docs/decisions/public-olympiad-reference-archive-2026-10-27.md */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { resolve } from 'node:path'

export function publicReferenceInput(root, book, read) {
  if (book.public_reference !== true || book.role !== 'teacher-guide'
    || !/^[a-z0-9-]{3,100}$/.test(book.id ?? '') || !book.title?.trim()
    || !book.sharing_basis?.trim() || !Array.isArray(book.authors)) throw new Error('public_reference_not_confirmed')
  const origin = new URL(book.source_url)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash) throw new Error('public_reference_origin_invalid')
  const path = resolve(root, book.pdf)
  if (!path.startsWith(resolve(root, 'library') + '/')) throw new Error('public_reference_path_invalid')
  const bytes = read(path)
  const index = JSON.parse(read(resolve(path, '../../search-index-teacher-guide.json')).toString())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (bytes.subarray(0, 5).toString() !== '%PDF-' || index.source_sha256 !== sha256
    || index.book_id !== book.id || index.source_pdf !== book.pdf
    || !Number.isInteger(index.pdf_page_count) || index.pdf_page_count < 1
    || index.pages.length !== index.pdf_page_count
    || index.pages.some((page, n) => page.pdf_page !== n + 1)) throw new Error('public_reference_index_mismatch')
  return { bytes, sha256, index, metadata: { id: book.id, title: book.title, authors: book.authors,
    year: book.year ?? null, subject: book.subject, grade: book.grade, role: 'teacher-guide',
    accessScope: 'public-reference', sourceUrl: origin.href, sourceSha256: sha256,
    pdfPageCount: index.pdf_page_count, printedPageOffset: index.printed_page_offset,
    editionStatus: book.edition_status, sharingBasis: book.sharing_basis } }
}

/** Explicitly registered public sources only; no family data or permission changes. */
export async function publishPublicReference({ db, storage, prepared, now }) {
  const { bytes, sha256, index, metadata } = prepared
  const diskPath = `app:/PETR/Общие-источники/${metadata.id}/${sha256}.pdf`
  await storage.putAt(diskPath, bytes)
  const publicPdfUrl = await storage.publish(diskPath)
  const url = new URL(publicPdfUrl)
  if (url.protocol !== 'https:' || !['yadi.sk', 'disk.yandex.ru', 'disk.yandex.com'].includes(url.hostname)) throw new Error('public_reference_url_invalid')
  const ref = db.doc(`materialBooks/${metadata.id}`)
  const document = { ...metadata, publicPdfUrl, privateDiskPath: diskPath }
  const previous = await ref.get()
  let changed = !isDeepStrictEqual(previous.data()?.publicReference, document)
  if (changed) {
    const batch = db.batch()
    batch.set(ref, { ...metadata, publicPdfUrl, publicReference: document, indexedAt: now }, { merge: true })
    for (const page of index.pages) batch.set(db.doc(`${ref.path}/pages/${page.pdf_page}`), {
      bookId: metadata.id, pdfPage: page.pdf_page, printedPage: page.printed_page,
      sourceRef: page.source_ref, sourceSha256: sha256, searchText: page.text,
      extraction: page.extraction, sourceUrl: `${publicPdfUrl}#page=${page.pdf_page}`, state: 'public-pdf',
    }, { merge: true })
    if (index.pages.length > 450) throw new Error('public_reference_too_many_pages')
    await batch.commit()
  }
  const saved = (await ref.get()).data()
  if (!isDeepStrictEqual(saved?.publicReference, document)) throw new Error('public_reference_readback_failed')
  const pages = await db.collection(`${ref.path}/pages`).get()
  if (pages.docs.length !== index.pdf_page_count || pages.docs.some(page => page.data().sourceSha256 !== sha256)) throw new Error('public_reference_pages_readback_failed')
  return { id: metadata.id, publicPdfUrl, sha256, pages: index.pdf_page_count, changed, verified: true }
}
