import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MaterialReader from './MaterialReader'
import type { DayMaterialLink } from '@/lib/dayStore'

/** @see ../../docs/product/materials.md#material-reader */
describe('adjacent textbook page slider', () => {
  const links = [150, 151].map((page): DayMaterialLink => ({
    title: `Starlight 6, стр. ${page}`, url: `https://disk.yandex.ru/i/page-${page}`,
    sourceType: 'textbook-page', sourceRef: `book#pdf-0${page}`, pdfPage: page,
    printedPage: page, sourceSha256: 'verified',
  }))
  it('renders one page at a time with page controls in the same block', () => {
    const html = renderToStaticMarkup(<MaterialReader links={links} parent={false} />)
    expect(html).toContain('стр. 150–151')
    expect(html).toContain('day-reader-slides')
    expect(html.match(/day-reader-thumb"/g)).toHaveLength(1)
    expect(html).toContain('Следующая страница')
    expect(html).toContain('1 из 2')
  })
})
