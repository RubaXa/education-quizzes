// @vitest-environment jsdom
// @see ../../docs/product/design-system.md#images
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import EducationImage from './EducationImage'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('teacher-sheet image recovery', () => {
  it('replaces a failed preview with a refreshed image before showing an error', async () => {
    const resolver = vi.fn(async (_source: string, _size: string, refresh: boolean) =>
      refresh ? 'https://preview.test/fresh.png' : 'https://preview.test/expired.png')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => { root.render(<EducationImage source="https://disk.yandex.ru/d/sheet" mode="public" resolver={resolver} alt="Лист" />) })
      expect(host.querySelector('img')?.src).toBe('https://preview.test/expired.png')
      await act(async () => { host.querySelector('img')?.dispatchEvent(new Event('error')) })
      expect(host.querySelector('.education-image')?.getAttribute('data-state')).toBe('loading')
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)) })
      expect(resolver).toHaveBeenLastCalledWith('https://disk.yandex.ru/d/sheet', 'XXXL', true)
      expect(host.querySelector('img')?.src).toBe('https://preview.test/fresh.png')
      await act(async () => { host.querySelector('img')?.dispatchEvent(new Event('load')) })
      expect(host.querySelector('.education-image')?.getAttribute('data-state')).toBe('ready')
    } finally {
      await act(async () => { root.unmount() })
      host.remove()
    }
  })
})
