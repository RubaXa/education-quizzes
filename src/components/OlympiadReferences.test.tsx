// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import OlympiadReferences from './OlympiadReferences'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
it('shows six official archive variants and a dated schedule', async () => {
  const host = document.createElement('div'), root = createRoot(host)
  try {
    await act(async () => root.render(<OlympiadReferences olympiadId="energy-hope-math-2026-2027" />))
    expect(host.textContent).toContain('22 и 28 ноября')
    const pdfs = [...host.querySelectorAll<HTMLAnchorElement>('a[data-archive-copy]')]
    expect(pdfs).toHaveLength(6)
    for (const anchor of pdfs) {
      expect(anchor.getAttribute('href')).toMatch(/^https:\/\/(disk\.yandex\.ru|disk\.yandex\.com|yadi\.sk)\//)
    }
    expect(host.textContent).toContain('Полный архив организатора')
  } finally { await act(async () => root.unmount()) }
})
