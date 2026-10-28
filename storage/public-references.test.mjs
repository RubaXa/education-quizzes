import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { publicReferenceInput, publishPublicReference } from './public-references.mjs'

const bytes = Buffer.from('%PDF-test')
const sha = createHash('sha256').update(bytes).digest('hex')
function input() {
  const book = { id: 'public-guide', title: 'Задачи и решения', role: 'teacher-guide', public_reference: true,
    sharing_basis: 'Explicit public-source archive request', authors: ['Автор'], source_url: 'https://example.org/guide.pdf',
    pdf: 'library/textbooks/public-guide/original/guide.pdf', subject: 'Математика', grade: 6, edition_status: 'confirmed' }
  const index = { book_id: book.id, source_pdf: book.pdf, source_sha256: sha, pdf_page_count: 1,
    printed_page_offset: 0, pages: [{ pdf_page: 1, printed_page: 1, source_ref: 'public-guide#pdf-0001', text: 'Задача', extraction: 'pdftotext' }] }
  return { book, index, read: path => path.endsWith('.pdf') ? bytes : Buffer.from(JSON.stringify(index)) }
}
describe('shared public reference archive', () => {
  it('rejects a family source without explicit public-reference registration', () => {
    const x = input();x.book.public_reference = false
    expect(() => publicReferenceInput('/repo', x.book, x.read)).toThrow('not_confirmed')
  })
  it('rejects an altered PDF or stale page index before publication', () => {
    const x = input();x.index.source_sha256 = '0'.repeat(64)
    expect(() => publicReferenceInput('/repo', x.book, x.read)).toThrow('index_mismatch')
  })
  it('rejects paths outside the source library and credential-bearing origins', () => {
    const x = input();x.book.pdf = '../private.pdf'
    expect(() => publicReferenceInput('/repo', x.book, x.read)).toThrow('path_invalid')
    x.book.source_url = 'https://user:secret@example.org/a.pdf'
    expect(() => publicReferenceInput('/repo', x.book, x.read)).toThrow('origin_invalid')
  })
  it('publishes one shared original, verifies pages, and safely reuses an identical repeat', async () => {
    const x = input(), records = new Map(), writes = []
    const db = { doc: path => ({ path, get: async () => ({ data: () => records.get(path) }) }),
      collection: path => ({ get: async () => ({ docs: [...records].filter(([key]) => key.startsWith(path + '/')).map(([,v]) => ({ data: () => v })) }) }),
      batch: () => ({ set: (ref, value) => writes.push([ref.path, value]), commit: async () => { for (const [path, value] of writes) records.set(path, value) } }) }
    const storage = { putAt: async () => ({}), publish: async () => 'https://yadi.sk/i/public-guide' }
    const prepared = publicReferenceInput('/repo', x.book, x.read)
    const first = await publishPublicReference({ db, storage, prepared, now: '2026-10-27' })
    expect(first).toMatchObject({ changed: true, verified: true, pages: 1 })
    const count = writes.length
    expect(await publishPublicReference({ db, storage, prepared, now: '2026-10-28' })).toMatchObject({ changed: false, verified: true })
    expect(writes.length).toBe(count)
    expect(records.get('materialBooks/public-guide').publicReference).not.toHaveProperty('familyId')
  })
})
