import { describe, expect, it } from 'vitest'
import { createTelegramDelivery } from './adapters/telegram.mjs'
import { renderNotificationParts } from './domain/renderer.mjs'

const part = renderNotificationParts({ eventType: 'upload.confirmed', source: 'firestore', privacyClass: 'family-summary', fields: { title: 'Упражнение' }, navigationContext: { kind: 'day', dayToken: 'demo-day' } }, 'family')[0]

function fakeApi(sendRichMessage) {
  return class Api {
    constructor() {
      this.config = { use() {} }
      this.sendRichMessage = sendRichMessage
      this.calls = []
    }
    async sendMessage(...args) { this.calls.push(['sendMessage', ...args]); return { message_id: 10 } }
  }
}

describe('Telegram Rich Messages transport', () => {
  it('sends native Rich Messages and records method/format receipts', async () => {
    let sent
    const Api = fakeApi(async (...args) => { sent = args; return { message_id: 7 } })
    const delivery = createTelegramDelivery('test', { ApiClass: Api })
    await expect(delivery.send({ chatId: '123', part })).resolves.toEqual({ messageId: 7, method: 'sendRichMessage', format: 'rich_message' })
    expect(sent).toEqual(['123', part.rich_message, {}])
  })

  it('falls back only for a definite unsupported method response', async () => {
    const Api = fakeApi(async () => { throw Object.assign(new Error('Bad Request: method sendRichMessage not found'), { error_code: 400 }) })
    const delivery = createTelegramDelivery('test', { ApiClass: Api })
    await expect(delivery.send({ chatId: 123, part })).resolves.toEqual({ messageId: 10, method: 'sendMessage', format: 'html-fallback' })
  })

  it.each([
    Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    Object.assign(new Error('server failure'), { error_code: 500 }),
    Object.assign(new Error('slow down'), { error_code: 429, parameters: { retry_after: 3 } }),
    Object.assign(new Error('Not Found'), { error_code: 404 }),
    Object.assign(new Error('Bad Request: invalid rich payload'), { error_code: 400 }),
  ])('does not send a second message after an ambiguous or unrelated Rich API error', async (error) => {
    const Api = fakeApi(async () => { throw error })
    const instance = new Api()
    const delivery = createTelegramDelivery('test', { ApiClass: class extends Api { constructor(...args) { super(...args); instance.calls = this.calls } } })
    await expect(delivery.send({ chatId: 123, part })).rejects.toMatchObject({ safeCode: expect.any(String) })
    expect(instance.calls).toHaveLength(0)
  })

  it('uses safe HTML and the same action button when the rich method is absent', async () => {
    let api
    const Api = class {
      constructor() { this.config = { use() {} }; this.calls = []; api = this }
      async sendMessage(...args) { this.calls.push(args); return { message_id: 11 } }
    }
    const delivery = createTelegramDelivery('test', { ApiClass: Api })
    await expect(delivery.send({ chatId: 1, part })).resolves.toMatchObject({ method: 'sendMessage', format: 'html-fallback' })
    expect(api.calls[0][1]).toBe(part.html)
    expect(api.calls[0][2].parse_mode).toBe('HTML')
    expect(api.calls[0][2].reply_markup.inline_keyboard).toEqual([part.keyboard.buttons])
  })
})
