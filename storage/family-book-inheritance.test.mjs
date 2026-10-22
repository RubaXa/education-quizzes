import { describe, expect, it, vi } from 'vitest'
import { inheritFamilyBooks, sharePublishedFamilyBook } from './family-book-inheritance.mjs'
vi.mock('./family-book-projection.mjs', () => ({
  projectPublishedBookToFamily: async (db, source, options) => db.prepareManifest(source, options),
}))

function fixture() {
  const base = 'families/family/children'
  const rows = new Map([
    [`${base}/older`, { displayName: 'Older' }], [`${base}/new`, { displayName: 'New' }],
    [`${base}/inactive`, { active: false }],
    ['families/other/children/foreign', { displayName: 'Foreign' }],
    [`${base}/older/books/book`, { bookId: 'book', title: 'Book', subjectKey: 'math', status: 'confirmed',
      sourceSha256: 'sha', pagesPublishedSha256: 'sha', pagesManifestSha256: 'sha',
      pagesPublishedAt: 'date', pdfPageCount: 1, evidence: { privateChildObservation: 'Do not copy' } }],
    [`${base}/older/bookPages/book#manifest`, { schemaVersion: 1, state: 'published-manifest',
      sourceSha256: 'sha', pageCount: 1, pages: [{ sourceType: 'textbook-page', sourceSha256: 'sha',
        pdfPage: 1, title: 'Page', url: 'https://example.test/page' }] }],
  ])
  const writes = []
  const db = {
    prepareManifest: async (source, options) => {
      expect(options).toEqual({ verifyCount: true, ensureManifest: true })
      rows.get(source.path).pagesManifestSha256 = rows.get(source.path).pagesPublishedSha256
      return { status: 'ready', familyShared: 0 }
    },
    doc: path => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path) }),
    collection: path => ({ get: async () => ({ docs: [...rows.keys()].filter(key => key.startsWith(`${path}/`)
      && key.slice(path.length + 1).indexOf('/') < 0).map(snapshot) }) }),
    runTransaction: async work => {
      const changes = []
      const result = await work({ getAll: async (...refs) => refs.map(ref => snapshot(ref.path)),
        set: (ref, data) => changes.push([ref.path, data]) })
      for (const [path, data] of changes) { writes.push(path); rows.set(path, data) }
      return result
    },
  }
  function snapshot(path) { return { id: path.split('/').at(-1), ref: db.doc(path), exists: rows.has(path), data: () => rows.get(path) } }
  return { db, rows, writes, base, source: db.doc(`${base}/older/books/book`) }
}

describe('books belong to the family', () => {
  it('a newly added child can read an older upload without re-upload or class confirmation', async () => {
    const f = fixture()
    expect(await inheritFamilyBooks(f.db, 'family', { targetChildId: 'new' })).toEqual({ shared: 1, pending: 0 })
    expect(f.rows.get(`${f.base}/new/books/book`)).toMatchObject({ accessScope: 'family', status: 'provisional',
      inheritedFromChildId: 'older', pagesManifestSha256: 'sha' })
    expect(f.rows.get(`${f.base}/new/books/book`)).not.toHaveProperty('evidence')
    expect(f.rows.get(`${f.base}/new/bookPages/book#manifest`).pages).toHaveLength(1)
    expect(f.writes.some(path => path.startsWith('families/other/'))).toBe(false)
    expect(f.rows.get(`${f.base}/older/books/book`).status).toBe('confirmed')
  })
  it('a subsequent family upload is shared with existing children, not inactive school accounts', async () => {
    const f = fixture()
    expect(await sharePublishedFamilyBook(f.db, f.source)).toEqual({ shared: 1 })
    expect(f.rows.has(`${f.base}/inactive/books/book`)).toBe(false)
    expect(f.rows.has('families/other/children/foreign/books/book')).toBe(false)
    expect(await sharePublishedFamilyBook(f.db, f.source)).toEqual({ shared: 0 })
    expect(f.writes).toHaveLength(2)
  })
  it('preserves a sibling\'s explicit edition and evidence', async () => {
    const f = fixture(), destination = `${f.base}/new/books/book`
    const selection = { status: 'confirmed', sourceSha256: 'other-scan', evidence: 'teacher-selection' }
    f.rows.set(destination, selection)
    expect(await sharePublishedFamilyBook(f.db, f.source)).toEqual({ shared: 0 })
    expect(f.rows.get(destination)).toEqual(selection)
    expect(f.writes).toHaveLength(0)
  })
  it('does not grant reading from a partial or wrong-edition manifest', async () => {
    const f = fixture()
    f.rows.get(`${f.base}/older/bookPages/book#manifest`).sourceSha256 = 'wrong'
    expect(await sharePublishedFamilyBook(f.db, f.source)).toEqual({ shared: 0, pending: true })
    expect(f.writes).toHaveLength(0)
  })
  it('does not infer a right from a book in another family or an inherited child record', async () => {
    const f = fixture()
    await expect(inheritFamilyBooks(f.db, 'family', { targetChildId: 'foreign' })).rejects.toThrow('not_in_family')
    f.rows.get(f.source.path).accessScope = 'family'
    expect(await sharePublishedFamilyBook(f.db, f.source)).toEqual({ shared: 0 })
  })
  it('prepares older v1 uploads instead of excluding them from a new child\'s library', async () => {
    const f = fixture()
    delete f.rows.get(f.source.path).pagesManifestSha256
    expect(await inheritFamilyBooks(f.db, 'family', { targetChildId: 'new' })).toEqual({ shared: 1, pending: 0 })
    expect(f.rows.get(`${f.base}/new/books/book`)).toMatchObject({ accessScope: 'family', pagesManifestSha256: 'sha' })
  })
})
