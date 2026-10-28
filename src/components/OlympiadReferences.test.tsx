// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import OlympiadReferences from './OlympiadReferences'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
it('shows six locally available official archive variants and a dated schedule', async () => {
  const host = document.createElement('div'), root = createRoot(host)
  try {
    await act(async () => root.render(<OlympiadReferences olympiadId="energy-hope-math-2026-2027" />))
    expect(host.textContent).toContain('22 и 28 ноября')
    const pdfs = [...host.querySelectorAll<HTMLAnchorElement>('a[href*="/olympiads/energy-hope/"]')]
    expect(pdfs).toHaveLength(6)
    for (const anchor of pdfs) {
      const name = anchor.getAttribute('href')!.split('/').at(-1)!
      const path = `public/olympiads/energy-hope/${name}`
      expect(existsSync(path)).toBe(true)
      expect(readFileSync(path).subarray(0, 4).toString()).toBe('%PDF')
    }
    expect(host.textContent).toContain('Полный архив организатора')
  } finally { await act(async () => root.unmount()) }
})
