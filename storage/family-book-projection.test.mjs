import { describe, expect, it, vi } from 'vitest'
import { projectPublishedBookToFamily, validFamilyBookManifest } from './family-book-projection.mjs'

function fixture({ binding = {}, pages = [], familyCount = 0, catalog = {} } = {}) {
  const familyRef = { parent: { id: 'families' } }
  const manifestWrites = []
  const familyPages = {
    where: vi.fn(() => ({ count: () => ({ get: async () => ({ data: () => ({ count: familyCount }) }) }) })),
    doc: vi.fn((id) => ({ id, set: async (data) => { manifestWrites.push({ id, data }) } })),
  }
  const childRef = { parent: { parent: familyRef }, collection: vi.fn(() => familyPages) }
  const bindingRef = {
    id: 'book-one', path: 'families/f/children/c/books/book-one', parent: { parent: childRef },
    get: async () => ({ data: () => ({ status: 'confirmed', sourceSha256: 'sha', ...binding }) }),
    set: vi.fn(async () => {}),
  }
  const written = []
  const db = {
    doc: vi.fn(() => ({ get: async () => ({ data: () => ({ role: 'student-textbook',
      sourceSha256: 'sha', pdfPageCount: pages.length || 2, ...catalog }) }) })),
    collection: vi.fn(() => ({ get: async () => ({ docs: pages.map((data) => ({
      id: String(data.pdfPage), data: () => data,
    })) }) })),
    batch: vi.fn(() => ({ set: (...args) => written.push(args), commit: async () => {} })),
  }
  return { db, bindingRef, written, manifestWrites, familyPages }
}

const page = (number) => ({ bookId: 'book-one', pdfPage: number, sourceSha256: 'sha',
  state: 'published', url: `https://disk.yandex.ru/d/page-${number}`, imageSha256: 'image',
  searchText: '', title: `Страница ${number}`, subject: 'Математика' })

describe('family book projection', () => {
  it('leaves an already complete family book untouched', async () => {
    const { db, bindingRef } = fixture({ binding: { pagesPublishedSha256: 'sha',
      pagesPublishedAt: new Date(), pdfPageCount: 2 }, familyCount: 2 })
    expect(await projectPublishedBookToFamily(db, bindingRef)).toMatchObject({ status: 'ready', projected: 0 })
    expect(db.collection).not.toHaveBeenCalled()
    expect(bindingRef.set).not.toHaveBeenCalled()
  })

  it('uses the shared index hash for a verified different family scan', async () => {
    const { db, bindingRef } = fixture({ binding: { sourceSha256: 'family-scan', catalogSha256: 'sha',
      pagesPublishedSha256: 'sha', pagesPublishedAt: new Date(), pdfPageCount: 2 }, familyCount: 2 })
    expect(await projectPublishedBookToFamily(db, bindingRef)).toMatchObject({ status: 'ready', projected: 0 })
  })

  it('does not mark an incomplete shared catalog as ready', async () => {
    const { db, bindingRef, written } = fixture({ pages: [page(1)], catalog: { pdfPageCount: 2 } })
    expect(await projectPublishedBookToFamily(db, bindingRef)).toMatchObject({ status: 'pending' })
    expect(written).toHaveLength(0)
    expect(bindingRef.set).not.toHaveBeenCalled()
  })

  it('projects only a bound family and writes the completion marker last', async () => {
    const { db, bindingRef, written, manifestWrites } = fixture({ pages: [page(1), page(2)], familyCount: 2 })
    expect(await projectPublishedBookToFamily(db, bindingRef)).toMatchObject({ status: 'ready', projected: 2 })
    expect(written).toHaveLength(2)
    expect(written[0][1]).not.toHaveProperty('searchText')
    expect(manifestWrites).toHaveLength(1)
    expect(manifestWrites[0].id).toBe('book-one#manifest')
    expect(manifestWrites[0].data).toMatchObject({ schemaVersion: 1, sourceSha256: 'sha', pageCount: 2 })
    expect(manifestWrites[0].data).not.toHaveProperty('bookId')
    expect(manifestWrites[0].data.pages).toHaveLength(2)
    expect(bindingRef.set).toHaveBeenCalledWith(expect.objectContaining({
      pagesPublishedSha256: 'sha', pdfPageCount: 2, pagesManifestSha256: 'sha',
    }), { merge: true })
  })

  it('backfills a manifest without rewriting old family pages or changing their revision', async () => {
    const { db, bindingRef, written, manifestWrites, familyPages } = fixture({
      pages: [page(1), page(2)], familyCount: 2,
      binding: { pagesPublishedSha256: 'sha', pagesPublishedAt: new Date(), pdfPageCount: 2 },
    })
    const result = await projectPublishedBookToFamily(db, bindingRef, { verifyCount: true, ensureManifest: true })
    expect(result).toMatchObject({ status: 'ready', projected: 0, manifest: 'published' })
    expect(familyPages.where).toHaveBeenCalledTimes(1)
    expect(written).toHaveLength(0)
    expect(manifestWrites).toHaveLength(1)
    expect(bindingRef.set).toHaveBeenCalledWith({ pagesManifestSha256: 'sha' }, { merge: true })
  })

  it('skips migration when the matching manifest marker already exists', async () => {
    const { db, bindingRef, manifestWrites } = fixture({ familyCount: 2,
      binding: { pagesPublishedSha256: 'sha', pagesManifestSha256: 'sha', pagesPublishedAt: new Date(), pdfPageCount: 2 },
    })
    expect(await projectPublishedBookToFamily(db, bindingRef, { ensureManifest: true })).toMatchObject({ status: 'ready', projected: 0 })
    expect(db.collection).not.toHaveBeenCalled()
    expect(manifestWrites).toHaveLength(0)
  })

  it('rejects manifest pages from another edition or with duplicate numbering', () => {
    const binding = { pagesPublishedSha256: 'sha', pagesManifestSha256: 'sha', pdfPageCount: 2 }
    const value = { schemaVersion: 1, state: 'published-manifest', sourceSha256: 'sha', pageCount: 2,
      pages: [page(1), page(2)].map((entry) => ({ ...entry, sourceType: 'textbook-page' })) }
    expect(validFamilyBookManifest(value, binding)).toBe(true)
    expect(validFamilyBookManifest({ ...value, pages: [value.pages[0], value.pages[0]] }, binding)).toBe(false)
    expect(validFamilyBookManifest(value, { ...binding, pagesManifestSha256: 'other' })).toBe(false)
  })
})
