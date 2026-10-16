import { describe, expect, it } from 'vitest'
import { materialPageDocument, needsPageWrite, selectPublicationPages } from './page-publication.mjs'

describe('адресная публикация учебной страницы', () => {
  const page = { id: 'book:30', bookId: 'book', title: 'Book, стр. 30', pdfPage: 30,
    printedPage: 30, sourceSha256: 'source', imageSha256: 'image', diskPath: '/page.png' }
  it('выбирает только назначенную страницу, не все соседние 88', () => {
    expect(selectPublicationPages([page, { ...page, id: 'book:31' }], 'book:30')).toEqual([page])
    expect(() => selectPublicationPages([page], 'other:30')).toThrow('taskPages')
  })
  it('не переписывает неизменный документ и не удаляет дополнительные поля', () => {
    const desired = materialPageDocument(page, 'https://disk.example/page')
    expect(needsPageWrite({ ...desired, preserved: 'family-independent metadata' }, desired)).toBe(false)
    expect(needsPageWrite({ ...desired, imageSha256: 'old' }, desired)).toBe(true)
    expect(needsPageWrite(undefined, desired)).toBe(true)
  })
})
