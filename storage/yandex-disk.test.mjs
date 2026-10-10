import { describe, expect, it } from 'vitest'
import { YandexDiskStorage } from './yandex-disk.mjs'

describe('Yandex Disk deletion', () => {
  it('closes a public link with PUT before moving an unreviewed photo to trash', async () => {
    const methods = []
    let exists = true
    const storage = new YandexDiskStorage('test-token', { fetcher: async (url, options) => {
      const endpoint = new URL(url).pathname.split('/').slice(3).join('/')
      methods.push(`${options.method} ${endpoint}`)
      if (options.method === 'GET' && !exists) return new Response('', { status: 404 })
      if (options.method === 'GET') return new Response(JSON.stringify({ type: 'file', md5: 'a'.repeat(32), public_url: 'https://disk.yandex.ru/test' }))
      if (options.method === 'DELETE') exists = false
      return new Response('{}')
    } })
    const path = `app:/PETR/Работы/2026-10-10/${'f'.repeat(22)}-${'c'.repeat(22)}/${'s'.repeat(43)}-${'u'.repeat(36)}.png`
    await storage.removeWorkAt(path, 'a'.repeat(32))
    expect(methods).toContain('PUT resources/unpublish')
    expect(methods.indexOf('PUT resources/unpublish')).toBeLessThan(methods.indexOf('DELETE resources'))
  })
})
