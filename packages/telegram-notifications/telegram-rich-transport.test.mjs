import { describe, expect, it } from 'vitest'
import { createTelegramDelivery } from './adapters/telegram.mjs'
import { renderNotificationParts } from './domain/renderer.mjs'
import { NotificationService } from './application/notifications.mjs'

const part = renderNotificationParts({ eventType: 'upload.confirmed', source: 'firestore', privacyClass: 'family-summary', fields: { title: 'Упражнение' }, navigationContext: { kind: 'day', dayToken: 'demo-day' } }, 'family')[0]
const legacyRichPart = { ...part }
delete legacyRichPart.format

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
    await expect(delivery.send({ chatId: '123', part: legacyRichPart })).resolves.toEqual({ messageId: 7, method: 'sendRichMessage', format: 'rich_message' })
    expect(sent).toEqual(['123', legacyRichPart.rich_message, {}])
  })

  it('falls back only for a definite unsupported method response', async () => {
    const Api = fakeApi(async () => { throw Object.assign(new Error('Bad Request: method sendRichMessage not found'), { error_code: 400 }) })
    const delivery = createTelegramDelivery('test', { ApiClass: Api })
    await expect(delivery.send({ chatId: 123, part: legacyRichPart })).resolves.toEqual({ messageId: 10, method: 'sendMessage', format: 'html-fallback' })
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
    await expect(delivery.send({ chatId: 123, part: legacyRichPart })).rejects.toMatchObject({ safeCode: expect.any(String) })
    expect(instance.calls).toHaveLength(0)
  })

  it('uses safe HTML and the same action button when the rich method is absent', async () => {
    let api
    const Api = class {
      constructor() { this.config = { use() {} }; this.calls = []; api = this }
      async sendMessage(...args) { this.calls.push(args); return { message_id: 11 } }
    }
    const delivery = createTelegramDelivery('test', { ApiClass: Api })
    await expect(delivery.send({ chatId: 1, part: legacyRichPart })).resolves.toMatchObject({ method: 'sendMessage', format: 'html-fallback' })
    expect(api.calls[0][1]).toBe(part.html)
    expect(api.calls[0][2].parse_mode).toBe('HTML')
    expect(api.calls[0][2].reply_markup.inline_keyboard).toEqual([part.keyboard.buttons])
  })

  it('sends new compact parts directly as newline-controlled HTML', async () => {
    let api
    const Api = class {
      constructor() { this.config = { use() {} }; this.calls = []; this.sendRichMessage = async () => { throw new Error('must not be called') }; api = this }
      async sendMessage(...args) { this.calls.push(args); return { message_id: 12 } }
    }
    const delivery = createTelegramDelivery('test', { ApiClass: Api })
    await expect(delivery.send({ chatId: 1, part })).resolves.toMatchObject({ method: 'sendMessage', format: 'html' })
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0][1]).toBe(part.html)
    expect(api.calls[0][2].parse_mode).toBe('HTML')
  })

  it('uses native Telegram replies and filters legacy UI Kit buttons without losing safe buttons', async () => {
    let api, richPayload
    const Api = class {
      constructor() { this.config = { use() {} }; this.calls = []; this.sendRichMessage = async (_chatId, payload) => { richPayload = payload; return { message_id: 13 } }; api = this }
      async sendMessage(...args) { this.calls.push(args); return { message_id: 14 } }
    }
    const delivery = createTelegramDelivery('test', { ApiClass: Api })
    const legacyUiKit = {
      ...legacyRichPart,
      format: 'html', replyToMessageId: 8,
      keyboard: { buttons: [{ text: 'Открыть UI Kit', url: 'https://rubaxa.github.io/education-quizzes/#/ui-kit' }] },
    }
    await delivery.send({ chatId: 1, part: legacyUiKit })
    expect(api.calls[0][2].reply_parameters).toEqual({ message_id: 8, allow_sending_without_reply: true })
    expect(api.calls[0][2].reply_markup).toBeUndefined()

    const legacyDayAction = { ...legacyUiKit, keyboard: part.keyboard }
    await delivery.send({ chatId: 1, part: legacyDayAction })
    expect(api.calls[1][2].reply_markup.inline_keyboard).toEqual([part.keyboard.buttons])

    const rich = { ...legacyUiKit, format: undefined, keyboard: undefined, rich_message: {
      blocks: [{ type: 'paragraph', text: 'legacy message' }, { type: 'buttons', buttons: [{ text: 'UI Kit', url: 'https://rubaxa.github.io/education-quizzes/#/ui-kit', style: 'primary' }] }],
    } }
    await delivery.send({ chatId: 1, part: rich })
    expect(api.calls).toHaveLength(2)
    expect(richPayload.blocks.some(block => block.type === 'buttons')).toBe(false)
  })

  it('delivers a queued legacy v2 UI Kit button after filtering it and leaves durable parts unchanged', async () => {
    const demoButton = { text: 'Open UI Kit', url: 'https://rubaxa.github.io/education-quizzes/#/ui-kit' }
    const originalPart = {
      ...part,
      format: 'html',
      demo: true,
      actionKind: 'demo',
      keyboard: { buttons: [demoButton] },
      rich_message: { blocks: [{ type: 'paragraph', text: part.plaintext }, { type: 'buttons', buttons: [{ ...demoButton, style: 'primary' }] }] },
    }
    delete originalPart.navigationContext
    const durableParts = structuredClone([originalPart])
    const job = { jobId: 'job-legacy', eventId: 'a'.repeat(64), linkId: 'link-a', familyId: 'family-a', personId: 'parent-a', childId: 'child-a', telegramUserId: '123', messageVersion: 2, messageParts: durableParts, partReceipts: [], attempts: 1 }
    let deliveredOptions, finalResult
    const outbox = {
      async claim() { return { ...job, state: 'leased', leaseToken: 'lease-a' } },
      async renew() {},
      async savePartReceipt() {},
      async finish({ result }) { finalResult = result },
      async reschedule() {}, async recoverExpired() {},
    }
    let api
    const Api = class {
      constructor() { this.config = { use() {} }; this.calls = []; api = this }
      async sendMessage(...args) { this.calls.push(args); deliveredOptions = args[2]; return { message_id: 21 } }
    }
    const service = new NotificationService({
      eventLedger: { async recordIfAbsent({ jobs }) { Object.assign(job, jobs[0]); return { accepted: true } } },
      outbox,
      recipients: { async resolveVerified() { return [{ type: 'family-link', linkId: 'link-a', familyId: 'family-a', personId: 'parent-a', childId: 'child-a', telegramUserId: '123' }] } },
      membership: { async isActiveMember() { return true } },
      renderer: () => [originalPart], delivery: createTelegramDelivery('test', { ApiClass: Api }), workerId: 'worker-a',
    })
    await service.accept({ source: 'firestore', familyId: 'family-a', childId: 'child-a', scopeKey: 'scope-a', sourceEventKey: 'event-a', sourceRevision: 'r1', eventType: 'technical.probe', privacyClass: 'family-summary' })
    expect(job.messageVersion).toBe(2)
    expect(await service.runOne({ jobId: job.jobId, skipRecovery: true })).toBe(true)
    expect(api.calls).toHaveLength(1)
    expect(deliveredOptions.reply_markup).toBeUndefined()
    expect(finalResult.state).toBe('sent')
    expect(job.messageParts).toEqual(durableParts)
  })
})
