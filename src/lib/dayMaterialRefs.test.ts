import { describe, expect, it } from 'vitest'
import { unresolvedMaterialPageRefs } from './dayMaterialRefs'
import type { DayMaterialLink } from './dayStore'

const link = (ref: string, url = 'https://disk.yandex.ru/page') => {
  const [bookId, page] = ref.split('#')
  return { title: 'Страница', url, sourceType: 'textbook-page',
    sourceRef: `${bookId}#pdf-${page.padStart(4, '0')}`, pdfPage: Number(page), sourceSha256: 'edition-hash' } as DayMaterialLink
}

describe('day material read budget', () => {
  it('reuses published links and eliminates per-page Firestore reads for a complete day', () => {
    const refs = Array.from({ length: 8 }, (_, index) => `book-2026#${index + 1}`)
    const page = { taskPageRefs: { task: refs }, materialLinks: { task: refs.map((ref) => link(ref)) } }
    const baseline = refs.length
    const candidate = unresolvedMaterialPageRefs(page).length
    expect(candidate).toBe(0)
    expect(100 * (baseline - candidate) / baseline).toBeGreaterThanOrEqual(20)
    console.log(JSON.stringify({ scenario: 'day-page/embedded-textbook-links/8-pages', metric: 'page-document-listeners', baseline, candidate, reductionPercent: 100 }))
  })

  it('keeps legacy and ambiguous links on the existing Firestore path', () => {
    const page = { taskPageRefs: { a: ['book#1', 'book#2'], b: ['book#2', 'book#3'] },
      materialLinks: { a: [link('book#1'), link('book#2', 'http://unsafe')],
        b: [link('book#2'), { ...link('book#3'), sourceSha256: '' }] } }
    expect(unresolvedMaterialPageRefs(page)).toEqual(['book#2', 'book#3'])
    expect(unresolvedMaterialPageRefs({ taskPageRefs: { a: ['book#1'] } })).toEqual(['book#1'])
  })

  it('does not treat teacher attachments or a different edition page as a textbook link', () => {
    const attachment = { ...link('book#7'), sourceType: 'teacher-attachment' } as DayMaterialLink
    const otherPage = { ...link('book#8'), sourceRef: 'book#pdf-0009' }
    expect(unresolvedMaterialPageRefs({ taskPageRefs: { a: ['book#7', 'book#8'] }, materialLinks: { a: [attachment, otherPage] } }))
      .toEqual(['book#7', 'book#8'])
  })
})
