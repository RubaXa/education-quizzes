import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { readMaterialPages, verifiedBookManifest, writeMaterialPages } from './materialPageCache'

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('education-material-cache-v1')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe('published textbook pages in local IndexedDB', () => {
  const pages = [1, 2, 3].map((pdfPage) => ({ title: `Страница ${pdfPage}`,
    url: `https://example.test/page-${pdfPage}.png`, sourceType: 'textbook-page' as const,
    sourceSha256: 'book-hash', pdfPage }))

  it('reuses only a complete set for the matching family binding and source hash', async () => {
    await writeMaterialPages('family/child/book/revision-1', pages)
    expect(await readMaterialPages('family/child/book/revision-1', 3, 'book-hash')).toEqual(pages)
    expect(await readMaterialPages('family/child/book/revision-2', 3, 'book-hash')).toBeNull()
    expect(await readMaterialPages('family/child/book/revision-1', 3, 'different-hash')).toBeNull()
    expect(await readMaterialPages('family/child/book/revision-1', 4, 'book-hash')).toBeNull()
  })

  it('rejects missing or repeated page numbers despite a matching page count', async () => {
    await writeMaterialPages('family/child/book/revision-1', [pages[0], pages[1], pages[1]])
    expect(await readMaterialPages('family/child/book/revision-1', 3, 'book-hash')).toBeNull()
    await writeMaterialPages('family/child/book/revision-1', [pages[0], pages[2]])
    expect(await readMaterialPages('family/child/book/revision-1', 3, 'book-hash')).toBeNull()
  })

  it('accepts only a complete manifest for the exact family binding edition', () => {
    const manifest = { schemaVersion: 1, state: 'published-manifest', sourceSha256: 'book-hash', pageCount: 3, pages }
    expect(verifiedBookManifest(manifest, 3, 'book-hash')).toEqual(pages)
    expect(verifiedBookManifest({ ...manifest, sourceSha256: 'other' }, 3, 'book-hash')).toBeNull()
    expect(verifiedBookManifest({ ...manifest, pages: [pages[0], pages[1], pages[1]] }, 3, 'book-hash')).toBeNull()
    expect(verifiedBookManifest({ ...manifest, pageCount: 2 }, 3, 'book-hash')).toBeNull()
  })
})
