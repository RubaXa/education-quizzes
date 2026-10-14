// @see ../../docs/product/design-system.md#images
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchWithRetry } = vi.hoisted(() => ({ fetchWithRetry: vi.fn() }))
vi.mock('./networkRetry', () => ({ fetchWithRetry }))

import { publicImage } from './yandexPublic'

describe('Yandex public image refresh', () => {
  beforeEach(() => fetchWithRetry.mockReset())

  it('refreshes a PDF page preview after image load failure instead of sending the PDF to img', async () => {
    fetchWithRetry
      .mockResolvedValueOnce({ ok: true, json: async () => ({ preview: 'https://preview.test/expired', file: 'https://disk.test/file.pdf' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ preview: 'https://preview.test/fresh', file: 'https://disk.test/file.pdf' }) })
    const link = 'https://disk.yandex.ru/d/teacher-sheet'
    expect(await publicImage(link, 'XXXL')).toBe('https://preview.test/expired')
    expect(await publicImage(link, 'XXXL', true)).toBe('https://preview.test/fresh')
    expect(fetchWithRetry).toHaveBeenCalledTimes(2)
    expect(fetchWithRetry.mock.calls.every(([endpoint]) => !String(endpoint).includes('/download'))).toBe(true)
  })
})
