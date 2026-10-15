// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MaterialReader from './MaterialReader'
import type { DayMaterialLink } from '@/lib/dayStore'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/** @see ../../docs/product/materials.md#material-reader */
describe('adjacent textbook page strip', () => {
  const links = [150, 151, 152, 153].map((page): DayMaterialLink => ({
    title: `Starlight 6, стр. ${page}`, url: `https://disk.yandex.ru/i/page-${page}`,
    sourceType: 'textbook-page', sourceRef: `book#pdf-0${page}`, pdfPage: page,
    printedPage: page, sourceSha256: 'verified',
  }))
  it.each([false, true])('renders every assigned page in one horizontally scrollable block for parent=%s', (parent) => {
    const html = renderToStaticMarkup(<MaterialReader links={links} parent={parent} />)
    expect(html).toContain('стр. 150–153')
    expect(html).toContain('day-reader-thumbs')
    expect(html.match(/day-reader-thumb"/g)).toHaveLength(4)
    for (const page of [150, 151, 152, 153]) expect(html).toContain(`Открыть Страница ${page}`)
    expect(html).not.toContain('day-reader-slide-controls')
  })

  it('opens the tapped thumbnail at the matching page in the large viewer', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => { root.render(<MaterialReader links={links} parent />) })
      await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Открыть Страница 153"]')!.click() })
      expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Starlight 6, Страница 153')
      expect(document.querySelector('.day-reader-dialog header span')?.textContent).toBe('Страница 153 · 4 из 4')
    } finally {
      await act(async () => { root.unmount() })
      host.remove()
    }
  })

  it('keeps the full family book in its one-page reader', () => {
    const html = renderToStaticMarkup(<MaterialReader links={links} parent book />)
    expect(html).toContain('day-reader-book')
    expect(html.match(/day-reader-book-page"/g)).toHaveLength(1)
    expect(html).toContain('Перейти к странице книги')
  })
})
