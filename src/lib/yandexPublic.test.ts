// @see ../../docs/shared/design/README.md#images
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchWithRetry } = vi.hoisted(() => ({ fetchWithRetry: vi.fn() }))
vi.mock('./networkRetry', () => ({ fetchWithRetry }))

import { publicAudio, publicImage } from './yandexPublic'

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

describe('Yandex public audio intent', () => {
  const bytes = new Uint8Array([73, 68, 51, 0, 0, 0, 0, 0, 0, 0])
  beforeEach(() => {
    fetchWithRetry.mockReset()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-audio')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg' } })))
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it('fetches a fresh Disk original on intent and creates an in-memory playable object', async () => {
    fetchWithRetry.mockResolvedValue({ ok: true, json: async () => ({ href: 'https://downloader.disk.yandex.ru/audio' }) })
    expect(await publicAudio('https://disk.yandex.ru/d/audio')).toBe('blob:verified-audio')
    expect(await publicAudio('https://disk.yandex.ru/d/audio')).toBe('blob:verified-audio')
    expect(fetchWithRetry).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenLastCalledWith(expect.any(URL), expect.objectContaining({ referrerPolicy: 'no-referrer', cache: 'no-store' }))
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
  })
  it('checks source SHA before making bytes playable', async () => {
    fetchWithRetry.mockResolvedValue({ ok: true, json: async () => ({ href: 'https://downloader.disk.yandex.ru/audio' }) })
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((n) => n.toString(16).padStart(2, '0')).join('')
    await expect(publicAudio('https://disk.yandex.ru/d/audio', hash)).resolves.toBe('blob:verified-audio')
    await expect(publicAudio('https://disk.yandex.ru/d/audio', '0'.repeat(64))).rejects.toThrow('не совпадает')
  })
  it('rejects non-Disk keys, unexpected origins, non-audio bytes and oversized files', async () => {
    await expect(publicAudio('https://example.org/audio')).rejects.toThrow()
    expect(fetchWithRetry).not.toHaveBeenCalled()
    fetchWithRetry.mockResolvedValueOnce({ ok: true, json: async () => ({ href: 'https://evil.example/audio' }) })
    await expect(publicAudio('https://disk.yandex.ru/d/audio')).rejects.toThrow()
    fetchWithRetry.mockResolvedValue({ ok: true, json: async () => ({ href: 'https://downloader.disk.yandex.ru/audio' }) })
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>error</html>'))
    await expect(publicAudio('https://disk.yandex.ru/d/audio')).rejects.toThrow('MP3')
    vi.mocked(fetch).mockResolvedValueOnce(new Response(bytes, { headers: { 'Content-Length': String(31 * 1024 * 1024) } }))
    await expect(publicAudio('https://disk.yandex.ru/d/audio')).rejects.toThrow()
  })
})
