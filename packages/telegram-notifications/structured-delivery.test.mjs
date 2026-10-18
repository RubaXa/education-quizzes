import { describe, expect, it } from 'vitest'
import { FieldValue, Firestore } from '@google-cloud/firestore'
import { NotificationService } from './application/notifications.mjs'
import { createMemoryStore } from './adapters/memory.mjs'
import { createDomainEvent } from './domain/events.mjs'
import { notificationMessageVersion, renderEvent, renderNotificationParts } from './domain/renderer.mjs'

const now = '2026-10-18T12:00:00.000Z'
function event() {
  return createDomainEvent({ source: 'firestore', scopeKey: 'scope-demo', familyId: 'family-demo', childId: 'child-demo',
    sourceEventKey: 'event-demo', sourceRevision: 'revision-demo', eventType: 'upload.confirmed',
    privacyClass: 'family-summary', detectedAt: now, fields: { childName: 'Ученик А', subject: 'Математика', title: 'Упражнение № 2' },
    navigationContext: { kind: 'day', dayToken: 'demo-day' } })
}
function twoStructuredParts(item) {
  const first = renderNotificationParts(item, 'family')[0]
  const second = structuredClone(first)
  second.plaintext += '\nДемонстрационная часть 2'
  second.html += '\n<i>Демонстрационная часть 2</i>'
  second.rich_message.blocks.push({ type: 'footer', text: { type: 'italic', text: 'Демонстрационная часть 2' } })
  return [first, second]
}
function harness(store, { renderer = renderNotificationParts, delivery, membership = async () => true, clock = () => new Date(now), workerId = 'structured-worker' }) {
  return new NotificationService({
    eventLedger: store.eventLedger, outbox: store.outbox,
    recipients: { async resolveVerified() { return [{ type: 'family-link', linkId: 'demo-link', familyId: 'family-demo', personId: 'parent-demo', childId: 'child-demo', telegramUserId: '501' }] } },
    membership: { async isActiveMember() { return membership() } },
    renderer, delivery, clock, workerId, logger: { info() {}, error() {} },
  })
}
function storeWithLink() {
  const store = createMemoryStore()
  store.addActiveLink({ linkId: 'demo-link', familyId: 'family-demo', personId: 'parent-demo', telegramUserId: '501' })
  return store
}

describe('durable structured notification delivery', () => {
  it('enqueues and delivers v2 parts through NotificationService with durable receipts', async () => {
    const store = storeWithLink()
    const sent = []
    const service = harness(store, { renderer: twoStructuredParts, delivery: { async send(message) { sent.push(message); return { messageId: sent.length, format: 'rich_message' } } } })
    await service.accept(event())
    const job = [...store.jobs.values()][0]
    expect(job.messageVersion).toBe(2)
    expect(notificationMessageVersion(job.messageParts)).toBe(2)
    expect(() => assertNoNestedArrays(job)).not.toThrow()
    await service.runOne()
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({ chatId: '501', part: job.messageParts[0] })
    expect(sent[1]).toMatchObject({ chatId: '501', part: job.messageParts[1] })
    expect(job.state).toBe('sent')
    expect(job.partReceipts).toEqual([{ messageId: 1, format: 'rich_message' }, { messageId: 2, format: 'rich_message' }])
  })

  it('after part two fails, restart sends only its stored v2 part without rerendering', async () => {
    const store = storeWithLink()
    const sentParts = []
    const firstService = harness(store, { renderer: twoStructuredParts, delivery: { async send({ part }) {
      sentParts.push(part)
      if (sentParts.length === 2) throw Object.assign(new Error('temporary'), { safeCode: 'telegram_temporary' })
      return { messageId: 10, method: 'sendRichMessage' }
    } } })
    await firstService.accept(event())
    const durableParts = structuredClone([...store.jobs.values()][0].messageParts)
    await firstService.runOne()
    const job = [...store.jobs.values()][0]
    expect(job).toMatchObject({ state: 'retry_wait', messageVersion: 2, partReceipts: [{ messageId: 10, method: 'sendRichMessage' }] })

    const retryParts = []
    const restarted = harness(store, {
      renderer() { throw new Error('restart_must_not_rerender') },
      delivery: { async send({ part }) { retryParts.push(part); return { messageId: 11, method: 'sendRichMessage' } } },
      clock: () => new Date(Date.parse(now) + 3_000), workerId: 'restarted-worker',
    })
    await restarted.runOne()
    expect(retryParts).toEqual([durableParts[1]])
    expect(sentParts).toEqual([durableParts[0], durableParts[1]])
    expect(job).toMatchObject({ state: 'sent', partReceipts: [{ messageId: 10, method: 'sendRichMessage' }, { messageId: 11, method: 'sendRichMessage' }] })
  })

  it('continues to deliver immutable v1 string jobs', async () => {
    const store = storeWithLink()
    const sent = []
    const service = harness(store, { renderer: renderEvent, delivery: { async send(message) { sent.push(message); return { messageId: 12 } } } })
    await service.accept(event())
    expect([...store.jobs.values()][0].messageVersion).toBe(1)
    await service.runOne()
    expect(sent).toEqual([{ chatId: '501', text: renderEvent(event(), 'family')[0] }])
    expect([...store.jobs.values()][0].state).toBe('sent')
  })

  it('dead-letters a tampered v2 job before delivery', async () => {
    const store = storeWithLink()
    let sends = 0
    const service = harness(store, { renderer: renderNotificationParts, delivery: { async send() { sends += 1; return {} } } })
    await service.accept(event())
    const job = [...store.jobs.values()][0]
    job.messageParts[0].rich_message.blocks[0].size = 99
    await service.runOne()
    expect(sends).toBe(0)
    expect(job).toMatchObject({ state: 'dead_letter', safeErrorCode: 'unsupported_job_schema' })
  })

  it('blocks delivery when membership has been revoked', async () => {
    const store = storeWithLink()
    let active = true
    let sends = 0
    const service = harness(store, { renderer: renderNotificationParts, membership: async () => active,
      delivery: { async send() { sends += 1; return {} } } })
    await service.accept(event())
    active = false
    await service.runOne()
    expect(sends).toBe(0)
    expect([...store.jobs.values()][0]).toMatchObject({ state: 'blocked', safeErrorCode: 'membership_inactive' })
  })

  it('accepts a flat durable DTO in the local Firestore SDK batch and rejects nested array elements', () => {
    const db = new Firestore({ projectId: 'demo-project' })
    const parts = renderNotificationParts(event(), 'family')
    const job = { messageVersion: 2, messageParts: parts }
    expect(parts[0].keyboard).toEqual({ buttons: [{ text: 'Открыть день', url: 'https://rubaxa.github.io/education-quizzes/#/day/demo-day' }] })
    expect(() => assertNoNestedArrays(job)).not.toThrow()
    expect(() => db.batch().create(db.doc('telegramNotificationOutbox/demo-job'), job)).not.toThrow()

    // The SDK validates arrayUnion elements synchronously, with no batch commit/network call.
    const oldKeyboard = [[{ text: 'Открыть день', url: 'https://rubaxa.github.io/education-quizzes/#/day/demo-day' }]]
    expect(() => db.batch().create(db.doc('telegramNotificationOutbox/old-shape'), {
      keyboard: FieldValue.arrayUnion(oldKeyboard),
    })).toThrow(/Nested arrays are not supported/)
  })
})

function assertNoNestedArrays(value) {
  if (Array.isArray(value)) {
    if (value.some(Array.isArray)) throw new Error('firestore_nested_array_not_supported')
    for (const item of value) assertNoNestedArrays(item)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) assertNoNestedArrays(item)
  }
}
