/** Family ownership grants reading to siblings; course/edition confirmation stays personal.
 * @see ../docs/modules/materials/family-library.md#family-access
 */
import { isDeepStrictEqual } from 'node:util'

const bookFields = ['bookId', 'title', 'subjectKey', 'sourceSha256', 'catalogSha256',
  'pdfPageCount', 'pagesPublishedSha256', 'pagesManifestSha256', 'pagesPublishedAt', 'audioLibrary']
const bindingPath = /^families\/([A-Za-z0-9_-]+)\/children\/([A-Za-z0-9_-]+)\/books\/([A-Za-z0-9_-]+)$/

export function validFamilyBookManifest(value, binding) {
  const sha = binding.pagesPublishedSha256, count = binding.pdfPageCount
  return value?.schemaVersion === 1 && value.state === 'published-manifest'
    && sha && binding.pagesManifestSha256 === sha && value.sourceSha256 === sha
    && Number.isInteger(count) && count > 0 && value.pageCount === count
    && Array.isArray(value.pages) && value.pages.length === count
    && value.pages.every(page => page?.sourceType === 'textbook-page'
      && page.sourceSha256 === sha && typeof page.title === 'string'
      && typeof page.url === 'string' && page.url.startsWith('https://')
      && Number.isInteger(page.pdfPage) && page.pdfPage >= 1 && page.pdfPage <= count)
    && new Set(value.pages.map(page => page.pdfPage)).size === count
}

export async function sharePublishedFamilyBook(db, sourceRef, { targetChildId } = {}) {
  const match = sourceRef.path.match(bindingPath)
  if (!match) throw new Error('family_book_source_path_invalid')
  const [, familyId, sourceChildId, bookId] = match
  const source = (await sourceRef.get()).data()
  if (!source || !['confirmed', 'provisional'].includes(source.status)
      || source.accessScope === 'family') return { shared: 0 }
  const children = await db.collection(`families/${familyId}/children`).get()
  const targets = children.docs.filter(child => child.id !== sourceChildId && child.data().active !== false
    && (!targetChildId || child.id === targetChildId))
  if (targetChildId && !children.docs.some(child => child.id === targetChildId)) throw new Error('family_book_target_not_in_family')
  if (!targets.length) return { shared: 0 }
  const boundSha = source.catalogSha256 ?? source.sourceSha256
  if (!boundSha || source.pagesPublishedSha256 !== boundSha
      || source.bookId && source.bookId !== bookId) return { shared: 0, pending: true }
  const manifest = (await db.doc(`families/${familyId}/children/${sourceChildId}/bookPages/${bookId}#manifest`).get()).data()
  if (!validFamilyBookManifest(manifest, source)) return { shared: 0, pending: true }
  const safe = Object.fromEntries(bookFields.filter(key => source[key] !== undefined).map(key => [key, source[key]]))
  const inherited = { ...safe, bookId, status: 'provisional', accessScope: 'family', inheritedFromChildId: sourceChildId }
  let shared = 0
  for (const child of targets) {
    const destination = db.doc(`families/${familyId}/children/${child.id}/books/${bookId}`)
    const pages = db.doc(`families/${familyId}/children/${child.id}/bookPages/${bookId}#manifest`)
    // Preserve a child's explicit edition selection, including provisional evidence.
    // Read every precondition in one transaction to avoid overwriting a concurrent selection.
    const changed = await db.runTransaction(async tx => {
      const [current, target, latestSource, latestManifest] = await tx.getAll(destination,
        db.doc(`families/${familyId}/children/${child.id}`), sourceRef,
        db.doc(`families/${familyId}/children/${sourceChildId}/bookPages/${bookId}#manifest`))
      if (!target.exists || target.data().active === false) return false
      if (current.exists && current.data().accessScope !== 'family') return false
      if (!isDeepStrictEqual(latestSource.data(), source)
          || !validFamilyBookManifest(latestManifest.data(), source)) throw new Error('family_book_source_changed')
      // Equivalent family uploads need not move an inherited grant between siblings.
      const next = current.exists && current.data().catalogSha256 === inherited.catalogSha256
        && current.data().pagesPublishedSha256 === inherited.pagesPublishedSha256
        ? { ...inherited, inheritedFromChildId: current.data().inheritedFromChildId ?? sourceChildId,
          ...(typeof current.data().sourceSha256 === 'string' ? { sourceSha256: current.data().sourceSha256 } : {}) } : inherited
      if (current.exists && isDeepStrictEqual(current.data(), next)) return false
      tx.set(pages, latestManifest.data())
      tx.set(destination, next)
      return true
    })
    if (changed) shared++
  }
  return { shared }
}

/** Provision a new child from this family's existing uploaded originals, without new uploads. */
export async function inheritFamilyBooks(db, familyId, { targetChildId } = {}) {
  if (!/^[A-Za-z0-9_-]+$/.test(familyId)) throw new Error('family_book_family_invalid')
  const children = await db.collection(`families/${familyId}/children`).get()
  if (targetChildId && !children.docs.some(child => child.id === targetChildId)) throw new Error('family_book_target_not_in_family')
  let shared = 0, pending = 0
  // Inactive children still supply evidence of the family's original upload.
  for (const child of children.docs) {
    const books = await db.collection(`families/${familyId}/children/${child.id}/books`).get()
    for (const book of books.docs) {
      if (book.data().accessScope === 'family') continue
      const source = book.data()
      // Older, already readable uploads can still have v1 page rows only.
      // Reuse their verified pages rather than excluding these family books.
      if (source.pagesPublishedAt && source.pagesManifestSha256 !== source.pagesPublishedSha256) {
        const { projectPublishedBookToFamily } = await import('./family-book-projection.mjs')
        const prepared = await projectPublishedBookToFamily(db, book.ref, { verifyCount: true, ensureManifest: true })
        shared += prepared.familyShared ?? 0
        if (prepared.status !== 'ready') { pending++; continue }
      }
      const result = await sharePublishedFamilyBook(db, book.ref, { targetChildId })
      shared += result.shared
      pending += result.pending ? 1 : 0
    }
  }
  return { shared, pending }
}
