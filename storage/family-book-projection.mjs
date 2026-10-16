import { Timestamp } from 'firebase-admin/firestore'

export function validFamilyBookManifest(value, binding) {
  const sha = binding.pagesPublishedSha256
  const count = binding.pdfPageCount
  return value?.schemaVersion === 1 && value.state === 'published-manifest'
    && sha && binding.pagesManifestSha256 === sha && value.sourceSha256 === sha
    && Number.isInteger(count) && count > 0 && value.pageCount === count
    && Array.isArray(value.pages) && value.pages.length === count
    && value.pages.every((page) => page?.sourceType === 'textbook-page'
      && page.sourceSha256 === sha && typeof page.title === 'string'
      && typeof page.url === 'string' && page.url.startsWith('https://')
      && Number.isInteger(page.pdfPage) && page.pdfPage >= 1 && page.pdfPage <= count)
    && new Set(value.pages.map((page) => page.pdfPage)).size === count
}

/**
 * Project an already indexed and published shared book into one family's view.
 * The family binding is the access grant; catalog presence alone grants nothing.
 * @see ../docs/modules/materials/family-library.md#full-book-reader
 */
export async function projectPublishedBookToFamily(db, bindingRef, { verifyCount = false, ensureManifest = false } = {}) {
  const binding = (await bindingRef.get()).data()
  const childRef = bindingRef.parent.parent
  const familyRef = childRef?.parent.parent
  if (!binding || !childRef || !familyRef || familyRef.parent.id !== 'families'
    || !['confirmed', 'provisional'].includes(binding.status)) {
    throw new Error(`Нет подтверждённой семейной связи: ${bindingRef.path}`)
  }
  const bookId = bindingRef.id
  const catalogSha256 = binding.catalogSha256 ?? binding.sourceSha256
  const catalog = (await db.doc(`materialBooks/${bookId}`).get()).data()
  if (!catalog || catalog.role !== 'student-textbook' || !catalogSha256
    || catalog.sourceSha256 !== catalogSha256 || !Number.isInteger(catalog.pdfPageCount)
    || catalog.pdfPageCount < 1) {
    return { status: 'pending', reason: 'catalog-not-ready', bookId }
  }
  const familyPages = childRef.collection('bookPages')
  let pagesReady = binding.pagesPublishedSha256 === catalogSha256 && binding.pagesPublishedAt
    && binding.pdfPageCount === catalog.pdfPageCount
  if (pagesReady) {
    // The marker is committed only after a full count at publication time.
    // Recounting every page on every EducationSync needlessly scans the same index.
    if (verifyCount) pagesReady = (await familyPages.where('bookId', '==', bookId).count().get()).data().count === catalog.pdfPageCount
    if (pagesReady && (!ensureManifest || binding.pagesManifestSha256 === catalogSha256)) {
      return { status: 'ready', bookId, pages: catalog.pdfPageCount, projected: 0 }
    }
  }
  const shared = await db.collection(`materialBooks/${bookId}/pages`).get()
  const pages = shared.docs.sort((a, b) => Number(a.id) - Number(b.id))
  if (pages.length !== catalog.pdfPageCount || pages.some((page, index) => {
    const data = page.data()
    return Number(page.id) !== index + 1 || data.pdfPage !== index + 1
      || data.bookId !== bookId || data.sourceSha256 !== catalogSha256
      || data.state !== 'published' || typeof data.url !== 'string'
      || !data.url.startsWith('https://') || typeof data.imageSha256 !== 'string'
      || typeof data.searchText !== 'string'
  })) return { status: 'pending', reason: 'catalog-pages-not-ready', bookId }

  let projected = 0
  if (!pagesReady) {
    let batch = db.batch(), pendingWrites = 0
    for (const page of pages) {
      const data = page.data()
      batch.set(familyPages.doc(`${bookId}#${data.pdfPage}`), {
        bookId, pdfPage: data.pdfPage, printedPage: data.printedPage ?? null,
        subject: data.subject, title: data.title, sourceRef: data.sourceRef,
        sourceSha256: catalogSha256, editionStatus: data.editionStatus,
        extraction: data.extraction, imageSha256: data.imageSha256,
        state: 'published', url: data.url, updatedAt: Timestamp.now(),
      }, { merge: true })
      pendingWrites += 1; projected += 1
      if (pendingWrites >= 240) { await batch.commit(); batch = db.batch(); pendingWrites = 0 }
    }
    if (pendingWrites) await batch.commit()
    const count = (await familyPages.where('bookId', '==', bookId).count().get()).data().count
    if (count !== pages.length) throw new Error(`${bindingRef.path}: опубликовано ${count} из ${pages.length} страниц.`)
  }

  // One family-scoped document replaces hundreds of initial page reads for a
  // cold reader. It has no `bookId` field, so old clients' page queries and
  // count audits still see only the v1 rows. Keep v1 rows for compatibility.
  const manifest = {
    schemaVersion: 1, state: 'published-manifest', sourceSha256: catalogSha256,
    pageCount: pages.length,
    pages: pages.map((page) => {
      const data = page.data()
      return JSON.parse(JSON.stringify({
        title: data.title, url: data.url, sourceType: 'textbook-page',
        sourceRef: data.sourceRef, pdfPage: data.pdfPage,
        printedPage: data.printedPage ?? null, editionStatus: data.editionStatus,
        extraction: data.extraction, sourceSha256: catalogSha256,
      }))
    }),
  }
  const manifestFits = Buffer.byteLength(JSON.stringify(manifest), 'utf8') <= 900_000
  if (manifestFits) await familyPages.doc(`${bookId}#manifest`).set(manifest)
  await bindingRef.set({
    ...(!pagesReady ? { pdfPageCount: pages.length, pagesPublishedSha256: catalogSha256,
      pagesPublishedAt: Timestamp.now() } : {}),
    pagesManifestSha256: manifestFits ? catalogSha256 : null,
  }, { merge: true })
  return { status: 'ready', bookId, pages: pages.length, projected, manifest: manifestFits ? 'published' : 'too-large' }
}
