import { describe, expect, it } from 'vitest'
import { diffCompleteSnapshots } from './domain/diff.mjs'
import { createDomainEvent } from './domain/events.mjs'
import { renderEvent } from './domain/renderer.mjs'
import { IdentityService } from './application/identity.mjs'
import { NotificationService } from './application/notifications.mjs'
import { createMemoryStore } from './adapters/memory.mjs'
import { createFirestoreAdapters } from './adapters/firestore.mjs'
import { loadConfig, safeFailureCode } from './adapters/config.mjs'
import { readFileSync } from 'node:fs'
import { HttpError } from 'grammy'
import { createTelegramAdapter, createTelegramDelivery } from './adapters/telegram.mjs'
import { runWorker } from './adapters/worker-loop.mjs'
import { EventEmitter } from 'node:events'

const now = '2026-10-16T12:00:00.000Z'
const event = () => createDomainEvent({ source: 'firestore', scopeKey: 'scope', familyId: 'family-a', childId: 'child-a', sourceEventKey: 'upload-1', sourceRevision: 'rev-1', eventType: 'upload.confirmed', privacyClass: 'family-summary', detectedAt: now, fields: { childName: 'Ученик А', status: 'загружено' } })

describe('Telegram notification vertical slice', () => {
  it('rejects non-private registration and sender-bound stop callbacks', async () => {
    const store = createMemoryStore()
    const identity = new IdentityService({ registry: store.registry, clock: () => new Date(now) })
    await expect(identity.start({ senderId: 5, chatType: 'group' })).rejects.toThrow('private_chat_required')
    store.addActiveLink({ linkId: 'link-a', familyId: 'family-a', telegramUserId: '5', label: 'Семья A' })
    const [{ callbackToken }] = (await identity.requestStop({ senderId: 5, chatType: 'private' })).choices
    await expect(identity.confirmStop({ senderId: 6, chatType: 'private', callbackToken })).resolves.toEqual({ code: 'invalid_confirmation' })
    await expect(identity.confirmStop({ senderId: 5, chatType: 'private', callbackToken })).resolves.toEqual({ code: 'disconnected' })
  })

  it('expires and consumes stop confirmation once, disconnecting only the selected family', async () => {
    const store = createMemoryStore()
    let instant = now
    const identity = new IdentityService({ registry: store.registry, clock: () => new Date(instant), confirmationTtlMs: 1_000 })
    store.addActiveLink({ linkId: 'link-a', familyId: 'family-a', telegramUserId: '5' })
    store.addActiveLink({ linkId: 'link-b', familyId: 'family-b', telegramUserId: '5' })
    const choices = (await identity.requestStop({ senderId: 5, chatType: 'private' })).choices
    expect(await identity.confirmStop({ senderId: 5, chatType: 'private', callbackToken: choices[0].callbackToken })).toEqual({ code: 'disconnected' })
    expect(await identity.confirmStop({ senderId: 5, chatType: 'private', callbackToken: choices[0].callbackToken })).toEqual({ code: 'invalid_confirmation' })
    expect(store.links.get('link-a').status).toBe('disconnected')
    expect(store.links.get('link-b').status).toBe('active')
    const expired = (await identity.requestStop({ senderId: 5, chatType: 'private' })).choices[0]
    instant = new Date(Date.parse(now) + 2_000).toISOString()
    expect(await identity.confirmStop({ senderId: 5, chatType: 'private', callbackToken: expired.callbackToken })).toEqual({ code: 'invalid_confirmation' })
  })

  it('uses Firestore transactions to bind one-use confirmations to sender and revokes only the selected live link', async () => {
    const db = new FakeFirestore()
    const adapters = createFirestoreAdapters(db)
    await db.doc('telegramBotFamilyLinks/link-a').set({ linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5', status: 'active' })
    await db.doc('telegramBotFamilyLinks/link-b').set({ linkId: 'link-b', familyId: 'family-b', personId: 'person-b', telegramUserId: '5', status: 'active' })
    await db.doc('families/family-a/members/person-a').set({ role: 'parent', active: true, childIds: ['child-a'] })
    const identity = new IdentityService({ registry: adapters.registry, clock: () => new Date(now) })
    const choices = (await identity.requestStop({ senderId: 5, chatType: 'private' })).choices
    const first = choices.find((item) => item.linkId === 'link-a')
    expect(JSON.stringify(db.records)).not.toContain(first.callbackToken)
    expect(await identity.confirmStop({ senderId: 9, chatType: 'private', callbackToken: first.callbackToken })).toEqual({ code: 'invalid_confirmation' })
    expect(await identity.confirmStop({ senderId: 5, chatType: 'private', callbackToken: first.callbackToken })).toEqual({ code: 'disconnected' })
    expect(await identity.confirmStop({ senderId: 5, chatType: 'private', callbackToken: first.callbackToken })).toEqual({ code: 'invalid_confirmation' })
    expect(await adapters.membership.isActiveMember({ linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5', childId: 'child-a' })).toBe(false)
    expect((await adapters.registry.listActiveLinks('5')).map((link) => link.linkId)).toEqual(['link-b'])
    const normalized = event()
    const rejected = await adapters.eventLedger.recordIfAbsent({ event: normalized, jobs: [{ jobId: `${normalized.eventId}_link-a`, eventId: normalized.eventId, event: normalized, linkId: 'link-a', familyId: 'family-a', personId: 'person-a', childId: 'child-a', telegramUserId: '5', state: 'pending', attempts: 0, nextAttemptAt: now, partReceipts: [] }] })
    expect(rejected.queued).toBe(0)
    let instant = now
    const expiring = new IdentityService({ registry: adapters.registry, clock: () => new Date(instant), confirmationTtlMs: 500 })
    const remaining = (await expiring.requestStop({ senderId: 5, chatType: 'private' })).choices[0]
    instant = new Date(Date.parse(now) + 1_000).toISOString()
    expect(await expiring.confirmStop({ senderId: 5, chatType: 'private', callbackToken: remaining.callbackToken })).toEqual({ code: 'invalid_confirmation' })
  })

  it('sets the first complete snapshot as baseline and does not advance on partial input', () => {
    const first = { complete: true, observationSequence: 1, records: [{ recordKey: 'g1', kind: 'grade', fields: { value: '5' } }] }
    const seeded = diffCompleteSnapshots({ source: 'mesh', scopeKey: 's', familyId: 'f', childId: 'c', current: first, detectedAt: now })
    expect(seeded.events).toHaveLength(0)
    const partial = { complete: false, observationSequence: 2, records: [] }
    const rejected = diffCompleteSnapshots({ source: 'mesh', scopeKey: 's', familyId: 'f', childId: 'c', previous: first, current: partial })
    expect(rejected.advanced).toBe(false)
    expect(rejected.baseline).toBe(first)
  })

  it('canonicalizes field order and distinguishes a repeated value reached through a different transition', () => {
    const snap = (observationSequence, value, fields = { value }) => ({ complete: true, observationSequence, records: [{ recordKey: 'g1', kind: 'grade', revision: `transport-${observationSequence}`, fields }] })
    const call = (previous, current) => diffCompleteSnapshots({ source: 'mesh', scopeKey: 's', familyId: 'f', childId: 'c', previous, current, detectedAt: now })
    const a = snap(10, '2', { subject: 'Math', value: '2' })
    const b = snap(11, '3', { value: '3', subject: 'Math' })
    const c = snap(12, '4', { subject: 'Math', value: '4' })
    const ab = call(a, b).events[0]
    expect(call(a, b).events[0].eventId).toBe(ab.eventId)
    expect(call(b, snap(12, '3', { subject: 'Math', value: '3' })).events).toEqual([])
    const cb = call(c, snap(13, '3', { subject: 'Math', value: '3' })).events[0]
    expect(ab.eventId).not.toBe(cb.eventId)
    const again = call(snap(13, '3', { subject: 'Math', value: '3' }), snap(14, '4', { subject: 'Math', value: '4' })).events[0]
    const repeated = call(snap(14, '4', { subject: 'Math', value: '4' }), snap(15, '3', { subject: 'Math', value: '3' })).events[0]
    expect(repeated.eventId).not.toBe(ab.eventId)
    expect(again).toBeTruthy()
  })

  it('detects schedule time and explicit event-type changes while normalizing equivalent instants', () => {
    const snap = (seq, extra) => ({ complete: true, observationSequence: seq, records: [{ recordKey: 's1', kind: 'schedule', fields: { title: 'Урок' }, ...extra }] })
    const call = (previous, current) => diffCompleteSnapshots({ source: 'mesh', scopeKey: 's', familyId: 'f', childId: 'c', previous, current, detectedAt: now })
    const before = snap(1, { occurredAt: '2026-10-16T08:00:00Z' })
    expect(call(before, snap(2, { occurredAt: '2026-10-16T09:00:00+01:00' })).events).toEqual([])
    expect(call(before, snap(2, { occurredAt: '2026-10-16T09:00:00Z' })).events).toHaveLength(1)
    expect(call(before, snap(2, { occurredAt: before.records[0].occurredAt, eventType: 'schedule.cancelled' })).events[0].eventType).toBe('schedule.cancelled')
  })

  it('requires durable snapshot sequence for event identity and rejects malformed complete snapshots', () => {
    const current = { complete: true, records: [{ recordKey: 'g', kind: 'grade', fields: { value: '4' } }] }
    const result = diffCompleteSnapshots({ source: 'mesh', scopeKey: 's', familyId: 'f', childId: 'c', current, detectedAt: now })
    expect(result.advanced).toBe(false)
    const duplicate = { complete: true, observationSequence: 1, records: [{ recordKey: 'g', kind: 'grade' }, { recordKey: 'g', kind: 'grade' }] }
    expect(diffCompleteSnapshots({ source: 'mesh', scopeKey: 's', familyId: 'f', childId: 'c', current: duplicate, detectedAt: now }).advanced).toBe(false)
  })

  it('deduplicates events, retries transient delivery, blocks recipients, and recovers stale leases', async () => {
    const store = createMemoryStore()
    store.addActiveLink({ linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' })
    let permitted = true
    let sendMode = 'retry'
    const service = new NotificationService({
      eventLedger: store.eventLedger, outbox: store.outbox,
      recipients: { async resolveVerified() { return [{ type: 'family-link', linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' }] } },
      membership: { async isActiveMember() { return permitted } }, renderer: renderEvent,
      delivery: { async send() { if (sendMode === 'retry') { const error = new Error(); error.safeCode = 'rate_limited'; error.retryAfterMs = 500; throw error } if (sendMode === 'blocked') { const error = new Error(); error.safeCode = 'recipient_blocked'; throw error } return { messageId: 9 } } },
      clock: () => new Date(now), workerId: 'test-worker', logger: { info() {}, error() {} },
    })
    const item = event()
    expect((await service.accept(item)).created).toBe(true)
    expect((await service.accept(item)).created).toBe(false)
    expect(store.jobs.size).toBe(1)
    await service.runOne()
    expect([...store.jobs.values()][0].state).toBe('retry_wait')
    // Retry the same job at its due time; a permanent block is recorded, not retried forever.
    const dueClock = new NotificationService({
      eventLedger: store.eventLedger, outbox: store.outbox,
      recipients: { async resolveVerified() { return [] } }, membership: { async isActiveMember() { return permitted } },
      renderer: renderEvent, delivery: { async send() { const error = new Error(); error.safeCode = 'recipient_blocked'; throw error } },
      clock: () => new Date(new Date(now).valueOf() + 1_000), workerId: 'test-worker', logger: { info() {}, error() {} },
    })
    sendMode = 'blocked'
    await dueClock.runOne()
    expect([...store.jobs.values()][0].state).toBe('blocked')
    // Lease recovery releases a job after a worker disappears; old owner cannot finish it.
    await store.outbox.enqueue([{ jobId: 'stale-job', state: 'pending', attempts: 0, nextAttemptAt: now }])
    const claim = await store.outbox.claim({ workerId: 'old', now, leaseMs: 50 })
    expect(claim.jobId).toBe('stale-job')
    const expired = new Date(Date.parse(now) + 100).toISOString()
    await store.outbox.recoverExpired(expired)
    await expect(store.outbox.finish({ jobId: 'stale-job', workerId: 'old', leaseToken: claim.leaseToken, now: expired, result: { state: 'sent' } })).rejects.toThrow('stale_lease')
    await store.outbox.recoverExpired(expired)
    const reclaimAt = new Date(Date.parse(expired) + 1_001).toISOString()
    const replacement = await store.outbox.claim({ workerId: 'old', now: reclaimAt, leaseMs: 50 })
    await expect(store.outbox.finish({ jobId: 'stale-job', workerId: 'old', leaseToken: claim.leaseToken, now: reclaimAt, result: { state: 'sent' } })).rejects.toThrow('stale_lease')
    expect(replacement.leaseToken).not.toBe(claim.leaseToken)
  })

  it('redacts non-whitelisted private fields and URLs from rendered text', () => {
    const item = createDomainEvent({ source: 'firestore', scopeKey: 'scope', familyId: 'family-a', childId: 'child-a', sourceEventKey: 'upload-1', sourceRevision: 'rev-1', eventType: 'homework.assigned', privacyClass: 'family-summary', detectedAt: now, fields: { childName: 'Ученик А', answerKey: 'secret', title: 'https://private.example/a' } })
    const text = renderEvent(item, 'family').join('')
    expect(text).toContain('[ссылка скрыта]')
    expect(text).not.toContain('secret')
    expect(text).not.toContain('answerKey')
    expect(text).not.toContain('https://')
    const long = createDomainEvent({ source: 'firestore', scopeKey: 'scope', familyId: 'family-a', childId: 'child-a', sourceEventKey: 'task', sourceRevision: 'rev', eventType: 'homework.assigned', privacyClass: 'family-summary', detectedAt: now, fields: { title: 'А'.repeat(500) } })
    const parts = renderEvent(long, 'family', { maxChars: 100 })
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((part, index) => part.startsWith(`📚 PETR · часть ${index + 1}/${parts.length}\n`) && [...part].length <= 100)).toBe(true)
  })

  it('normalizes application input before persistence and never stores caller private fields', async () => {
    const store = createMemoryStore()
    store.addActiveLink({ linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' })
    const service = new NotificationService({ eventLedger: store.eventLedger, outbox: store.outbox,
      recipients: { async resolveVerified() { return [{ type: 'family-link', linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' }] } },
      membership: { async isActiveMember() { return true } }, renderer: renderEvent, delivery: { async send() { return {} } },
      clock: () => new Date(now), workerId: 'safe', logger: { info() {}, error() {} },
    })
    const raw = { ...event(), privateAnswer: 'do-not-persist', fields: { childName: 'Ученик А', answerKey: 'do-not-persist', value: 'raw-private-value' } }
    await service.accept(raw)
    const stored = JSON.stringify({ events: [...store.events.values()], jobs: [...store.jobs.values()] })
    expect(stored).not.toContain('do-not-persist')
    expect(stored).not.toContain('raw-private-value')
  })

  it('retries only undelivered parts after a failure and retains prior part receipts', async () => {
    const store = createMemoryStore()
    store.addActiveLink({ linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' })
    let instant = now
    let calls = 0
    let renderedPartTwo = 'part-two'
    const sent = []
    const service = new NotificationService({ eventLedger: store.eventLedger, outbox: store.outbox,
      recipients: { async resolveVerified() { return [{ type: 'family-link', linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' }] } },
      membership: { async isActiveMember() { return true } }, renderer: () => ['part-one', renderedPartTwo],
      delivery: { async send({ text }) { calls += 1; sent.push(text); if (calls === 2) { const error = new Error(); error.safeCode = 'telegram_temporary'; throw error } return { text } } },
      clock: () => new Date(instant), workerId: 'parts', logger: { info() {}, error() {} },
    })
    await service.accept(event())
    await service.runOne()
    expect([...store.jobs.values()][0].partReceipts).toEqual([{ text: 'part-one' }])
    renderedPartTwo = 'new-template-must-not-be-used'
    instant = new Date(Date.parse(now) + 3_000).toISOString()
    await service.runOne()
    expect(calls).toBe(3)
    expect(sent).toEqual(['part-one', 'part-two', 'part-two'])
    expect([...store.jobs.values()][0].state).toBe('sent')
    expect([...store.jobs.values()][0].partReceipts).toEqual([{ text: 'part-one' }, { text: 'part-two' }])
  })

  it('uses safe startup codes and defines the two composite indexes required by its queries', () => {
    expect(safeFailureCode(new Error('privatevalue'))).toBe('startup_failed')
    expect(safeFailureCode(new Error('firestore_project_missing'))).toBe('firestore_project_missing')
    expect(() => loadConfig({ AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwxyz' })).toThrow('firestore_project_missing')
    const indexFile = new URL('./firestore.indexes.json', import.meta.url)
    const manifest = JSON.parse(readFileSync(indexFile, 'utf8'))
    expect(manifest.indexes).toHaveLength(2)
    expect(manifest.indexes.map((index) => index.fields.map((field) => field.fieldPath))).toEqual([
      ['state', 'nextAttemptAt'], ['state', 'leaseUntil'],
    ])
  })

  it('fences Firestore leases when the same worker reclaims a recovered job', async () => {
    const db = new FakeFirestore()
    const adapters = createFirestoreAdapters(db)
    await db.doc('telegramNotificationOutbox/job-a').set({ jobId: 'job-a', state: 'pending', nextAttemptAt: now, attempts: 0 })
    const first = await adapters.outbox.claim({ workerId: 'same-worker', now, leaseMs: 50 })
    const expired = new Date(Date.parse(now) + 100).toISOString()
    await adapters.outbox.recoverExpired(expired)
    const reclaimAt = new Date(Date.parse(expired) + 1_001).toISOString()
    const second = await adapters.outbox.claim({ workerId: 'same-worker', now: reclaimAt, leaseMs: 50 })
    expect(first.leaseToken).not.toBe(second.leaseToken)
    await expect(adapters.outbox.finish({ jobId: 'job-a', workerId: 'same-worker', leaseToken: first.leaseToken, now: reclaimAt, result: { state: 'sent' } })).rejects.toMatchObject({ safeCode: 'stale_lease' })
    await adapters.outbox.finish({ jobId: 'job-a', workerId: 'same-worker', leaseToken: second.leaseToken, now: reclaimAt, result: { state: 'sent' } })
    expect((await db.doc('telegramNotificationOutbox/job-a').get()).data().state).toBe('sent')
  })

  it('limits crashes by counting every claim and dead-letters after the configured maximum', async () => {
    const store = createMemoryStore()
    await store.outbox.enqueue([{ jobId: 'crash-job', state: 'pending', attempts: 0, nextAttemptAt: now }])
    const first = await store.outbox.claim({ workerId: 'worker', now, leaseMs: 10, maxAttempts: 2 })
    const expired1 = new Date(Date.parse(now) + 20).toISOString()
    await store.outbox.recoverExpired(expired1, { maxAttempts: 2, recoveryDelayMs: 1 })
    const secondAt = new Date(Date.parse(expired1) + 2).toISOString()
    const second = await store.outbox.claim({ workerId: 'worker', now: secondAt, leaseMs: 10, maxAttempts: 2 })
    expect(first.attempts).toBe(1)
    expect(second.attempts).toBe(2)
    const expired2 = new Date(Date.parse(secondAt) + 20).toISOString()
    await store.outbox.recoverExpired(expired2, { maxAttempts: 2, recoveryDelayMs: 1 })
    expect(store.jobs.get('crash-job').state).toBe('dead_letter')
    expect(await store.outbox.claim({ workerId: 'worker', now: new Date(Date.parse(expired2) + 2).toISOString(), leaseMs: 10, maxAttempts: 2 })).toBeNull()
  })

  it('applies crash attempt cap in Firestore transactions too', async () => {
    const db = new FakeFirestore()
    const outbox = createFirestoreAdapters(db).outbox
    await db.doc('telegramNotificationOutbox/crash-db').set({ jobId: 'crash-db', state: 'pending', attempts: 0, nextAttemptAt: now })
    const first = await outbox.claim({ workerId: 'worker', now, leaseMs: 10, maxAttempts: 2 })
    const expired1 = new Date(Date.parse(now) + 20).toISOString()
    await outbox.recoverExpired(expired1, { maxAttempts: 2, recoveryDelayMs: 1 })
    const secondAt = new Date(Date.parse(expired1) + 2).toISOString()
    const second = await outbox.claim({ workerId: 'worker', now: secondAt, leaseMs: 10, maxAttempts: 2 })
    expect([first.attempts, second.attempts]).toEqual([1, 2])
    const expired2 = new Date(Date.parse(secondAt) + 20).toISOString()
    await outbox.recoverExpired(expired2, { maxAttempts: 2, recoveryDelayMs: 1 })
    expect((await db.doc('telegramNotificationOutbox/crash-db').get()).data().state).toBe('dead_letter')
  })

  it('interrupts idle delivery wait and always terminates the database on signal', async () => {
    const signals = new EventEmitter()
    let finishStart
    let stopped = 0
    let terminated = 0
    let iterations = 0
    const runtime = {
      telegram: {
        bot: { isRunning: () => true },
        async start() { await new Promise((resolve) => { finishStart = resolve }) },
        async stop() { stopped += 1; finishStart() },
      },
      db: { async terminate() { terminated += 1 } },
      notificationService: { async runOne() { iterations += 1; return false } },
    }
    const running = runWorker({ runtime, enableDelivery: true, logger: { info() {}, error() {} }, processLike: signals, random: () => 0 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    signals.emit('SIGTERM')
    await expect(running).resolves.toEqual({ ok: true })
    expect(stopped).toBe(1)
    expect(terminated).toBe(1)
    expect(iterations).toBe(1)
  })

  it('waits for an in-flight grammY handler before terminating Firestore', async () => {
    const signals = new EventEmitter()
    let finishPoll
    let finishHandler
    let handlerDone = false
    let terminatedAfterHandler = false
    const runtime = {
      telegram: {
        bot: { isRunning: () => true },
        async start() { await new Promise((resolve) => { finishPoll = resolve }); await new Promise((resolve) => { finishHandler = resolve }); handlerDone = true },
        async stop() { finishPoll() },
      },
      db: { async terminate() { terminatedAfterHandler = handlerDone } },
    }
    const running = runWorker({ runtime, enableDelivery: false, logger: { info() {}, error() {} }, processLike: signals })
    await new Promise((resolve) => setTimeout(resolve, 0))
    signals.emit('SIGTERM')
    setTimeout(() => finishHandler(), 5)
    await expect(running).resolves.toEqual({ ok: true })
    expect(terminatedAfterHandler).toBe(true)
  })

  it('uses the shared shutdown deadline and safe exit if polling cannot stop', async () => {
    class FakeProcess extends EventEmitter { exit(code) { this.exitCode = code } }
    const signals = new FakeProcess()
    const keepAlive = setInterval(() => {}, 100)
    const runtime = {
      telegram: { bot: { isRunning: () => true }, async start() { await new Promise(() => {}) }, async stop() { await new Promise(() => {}) } },
      db: { async terminate() {} },
    }
    const running = runWorker({ runtime, enableDelivery: false, logger: { info() {}, error() {} }, processLike: signals, shutdownMs: 15 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    signals.emit('SIGTERM')
    await expect(running).resolves.toEqual({ ok: false })
    clearInterval(keepAlive)
    expect(signals.exitCode).toBe(1)
  })

  it('configures grammY request timeouts and maps its real HttpError to a retryable failure', async () => {
    const calls = []
    class FakeBot {
      constructor(token, options) { calls.push(['bot', token, options]); this.api = { config: { use() {} } } }
      command() {}
      callbackQuery() {}
      catch() {}
      async start(options) { calls.push(['poll', options]) }
      async stop() {}
    }
    class FakeApi {
      constructor(token, options) { calls.push(['api', token, options]); this.config = { use() {} } }
      async getMe() { return { id: 1, username: 'agi_edu_bot' } }
      async sendMessage() { throw new HttpError('sendMessage failed', new Error('socket reset')) }
    }
    const adapter = createTelegramAdapter({ token: 'test-only', identity: {}, BotClass: FakeBot, ApiClass: FakeApi })
    await adapter.verifyIdentity()
    await adapter.start()
    expect(calls).toContainEqual(['bot', 'test-only', { client: { timeoutSeconds: 20 } }])
    expect(calls).toContainEqual(['api', 'test-only', { timeoutSeconds: 20 }])
    expect(calls).toContainEqual(['poll', { timeout: 10 }])
    await expect(createTelegramDelivery('test-only', { ApiClass: FakeApi }).send({ chatId: 1, text: 'x' })).rejects.toMatchObject({ safeCode: 'telegram_temporary' })
  })
})

class FakeFirestore {
  records = new Map()
  tail = Promise.resolve()
  collection(name) { return new FakeCollection(this, name) }
  doc(path) { return new FakeDocument(this, path) }
  collectionGroup(name) { return new FakeCollection(this, name) }
  runTransaction(callback) {
    const result = this.tail.then(() => callback({
      get: (ref) => ref.get(),
      create: (ref, data) => ref.create(data),
      set: (ref, data, options) => ref.set(data, options),
      update: (ref, data) => ref.update(data),
    }))
    this.tail = result.catch(() => undefined)
    return result
  }
  batch() { const writes = []; return { create: (ref, data) => writes.push(() => ref.create(data)), set: (ref, data, options) => writes.push(() => ref.set(data, options)), update: (ref, data) => writes.push(() => ref.update(data)), commit: async () => Promise.all(writes.map((write) => write())) } }
}
class FakeCollection {
  constructor(db, path) { this.db = db; this.path = path; this.filters = [] }
  doc(id) { return new FakeDocument(this.db, `${this.path}/${id}`) }
  where(field, op, value) { const clone = new FakeCollection(this.db, this.path); clone.filters = [...this.filters, [field, op, value]]; return clone }
  limit() { return this }
  orderBy() { return this }
  async get() {
    const prefix = `${this.path}/`
    const docs = [...this.db.records.entries()].filter(([path, data]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/') && this.filters.every(([field, op, value]) => op === '==' ? data[field] === value : op === '<=' ? data[field] <= value : op === 'in' ? value.includes(data[field]) : false)).map(([path, data]) => new FakeDocumentSnapshot(new FakeDocument(this.db, path), data))
    return { docs, size: docs.length }
  }
}
class FakeDocument {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').at(-1) }
  async get() { return new FakeDocumentSnapshot(this, this.db.records.get(this.path)) }
  async create(data) { if (this.db.records.has(this.path)) throw new Error('already_exists'); this.db.records.set(this.path, structuredClone(data)) }
  async set(data, options = {}) { this.db.records.set(this.path, options.merge ? { ...this.db.records.get(this.path), ...structuredClone(data) } : structuredClone(data)) }
  async update(data) { if (!this.db.records.has(this.path)) throw new Error('missing'); this.db.records.set(this.path, { ...this.db.records.get(this.path), ...structuredClone(data) }) }
}
class FakeDocumentSnapshot {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this.exists = data !== undefined; this._data = data }
  data() { return this._data }
}
