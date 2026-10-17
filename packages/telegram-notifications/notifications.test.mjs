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
import { createHash } from 'node:crypto'
import { createTelemetry } from '../education-runtime/telemetry.mjs'

/** @see ../../docs/services/telegram-bot/ports-and-events.md */

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

  it('requires a strict boolean completeness flag and a valid detectedAt before any baseline moves', () => {
    const previous = { complete: true, observationSequence: 1, records: [{ recordKey: 'g1', kind: 'grade', fields: { value: '5' } }] }
    for (const complete of ['partial', 'unknown', 1, {}, false]) {
      const current = { complete, observationSequence: 2, records: [] }
      const rejected = diffCompleteSnapshots({ source: 'mesh', scopeKey: 's', familyId: 'f', childId: 'c', previous, current, detectedAt: now })
      expect(rejected.advanced).toBe(false)
      expect(rejected.baseline).toBe(previous)
      const withoutBaseline = diffCompleteSnapshots({ source: 'mesh', scopeKey: 's', familyId: 'f', childId: 'c', current, detectedAt: now })
      expect(withoutBaseline.advanced).toBe(false)
      expect(withoutBaseline.baseline).toBeUndefined()
    }
    const invalidPrevious = diffCompleteSnapshots({ source: 'mesh', scopeKey: 's', familyId: 'f', childId: 'c', previous: { ...previous, complete: 'yes' }, current: { complete: true, observationSequence: 2, records: [] }, detectedAt: now })
    expect(invalidPrevious).toMatchObject({ advanced: false, events: [] })
    expect(invalidPrevious.baseline.complete).toBe('yes')
    const partial = diffCompleteSnapshots({ source: 'mesh', scopeKey: 's', familyId: 'f', childId: 'c', previous, current: { complete: false, observationSequence: 2, records: [] }, detectedAt: now })
    expect(partial.advanced).toBe(false)
    expect(diffCompleteSnapshots({ source: 'mesh', scopeKey: 's', familyId: 'f', childId: 'c', current: { complete: true, observationSequence: 2, records: [] }, detectedAt: 'not-a-time' })).toMatchObject({ advanced: false, baseline: undefined, events: [] })
  })

  it('normalizes context reference IDs idempotently while hashing raw source IDs', () => {
    const raw = { source: 'firestore', scopeKey: 'scope', familyId: 'family-a', childId: 'child-a', sourceEventKey: 'event', sourceRevision: 'rev', eventType: 'homework.assigned', privacyClass: 'family-summary', detectedAt: now, contextRefs: [{ kind: 'task', id: 'private-task-id' }] }
    const once = createDomainEvent(raw)
    const twice = createDomainEvent(once)
    expect(twice.contextRefs).toEqual(once.contextRefs)
    expect(once.eventId).toBe(twice.eventId)
    expect(once.contextRefs[0].id).not.toBe('private-task-id')
  })

  it('tracks private Telegram reachability separately from family links and rejects stale or unbound membership updates', async () => {
    const store = createMemoryStore()
    store.addActiveLink({ linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' })
    const identity = new IdentityService({ registry: store.registry, clock: () => new Date(now) })
    await identity.start({ senderId: 5, chatType: 'private', updateId: 100, occurredAt: now })
    expect(await store.channel.getState('5')).toMatchObject({ status: 'available', version: 1 })
    await expect(identity.observeChannelMembership({ senderId: 5, chatId: 6, actorId: 5, chatType: 'private', botUserId: 99, expectedBotUserId: 99, updateId: 101, occurredAt: '2026-10-16T12:00:01.000Z', status: 'blocked' })).resolves.toMatchObject({ updated: false })
    await expect(identity.observeChannelMembership({ senderId: 5, chatId: 5, actorId: 5, chatType: 'private', botUserId: 99, expectedBotUserId: 99, updateId: 101, occurredAt: '2026-10-16T12:00:01.000Z', status: 'blocked' })).resolves.toMatchObject({ updated: true })
    expect(await store.channel.getState('5')).toMatchObject({ status: 'blocked', version: 2 })
    await identity.start({ senderId: 5, chatType: 'private', updateId: 99, occurredAt: now })
    expect(await store.channel.getState('5')).toMatchObject({ status: 'blocked', version: 2 })
    await identity.start({ senderId: 5, chatType: 'private', updateId: 102, occurredAt: '2026-10-16T12:00:01.000Z' })
    expect(await store.channel.getState('5')).toMatchObject({ status: 'available', version: 3 })
    await identity.observeChannelMembership({ senderId: 5, chatId: 5, actorId: 5, chatType: 'private', botUserId: 99, expectedBotUserId: 99, updateId: 103, occurredAt: '2026-10-16T12:00:02.000Z', status: 'blocked' })
    expect(await store.channel.getState('5')).toMatchObject({ status: 'blocked', version: 4 })
    await identity.observeChannelMembership({ senderId: 5, chatId: 5, actorId: 5, chatType: 'private', botUserId: 99, expectedBotUserId: 99, updateId: 102, occurredAt: '2026-10-16T12:00:03.000Z', status: 'available' })
    expect(await store.channel.getState('5')).toMatchObject({ status: 'blocked', version: 4 })
    await identity.start({ senderId: 5, chatType: 'private', updateId: 104, occurredAt: '2026-10-16T12:00:04.000Z' })
    expect(await store.channel.getState('5')).toMatchObject({ status: 'available', version: 5 })
    await expect(identity.observeChannelMembership({ senderId: 5, chatId: 5, actorId: 5, chatType: 'private', botUserId: undefined, expectedBotUserId: undefined, updateId: 105, occurredAt: '2026-10-16T12:00:05.000Z', status: 'blocked' })).resolves.toMatchObject({ updated: false })
    await expect(identity.observeChannelMembership({ senderId: 5, chatId: 5, actorId: 7, chatType: 'private', botUserId: 99, expectedBotUserId: 99, updateId: 105, occurredAt: '2026-10-16T12:00:05.000Z', status: 'blocked' })).resolves.toMatchObject({ updated: false })
    await expect(identity.observeChannelMembership({ senderId: 5, chatId: 5, actorId: 5, chatType: 'private', botUserId: 98, expectedBotUserId: 99, updateId: 105, occurredAt: '2026-10-16T12:00:05.000Z', status: 'blocked' })).resolves.toMatchObject({ updated: false })
    await expect(identity.observeChannelMembership({ senderId: 5, chatId: 6, actorId: 5, chatType: 'group', botUserId: 99, expectedBotUserId: 99, updateId: 105, occurredAt: '2026-10-16T12:00:05.000Z', status: 'blocked' })).resolves.toMatchObject({ updated: false })
    expect(store.links.get('link-a').status).toBe('active')
  })

  it('persists channel ordering and stale 403 fences transactionally in the Firestore adapter', async () => {
    const db = new FakeFirestore()
    const adapters = createFirestoreAdapters(db)
    await adapters.registry.registerAccount({ senderId: '5', username: '', firstName: '', at: now })
    expect(await adapters.registry.recordChannelUpdate({ senderId: '5', status: 'blocked', updateId: 10, observedAt: Date.parse(now) })).toMatchObject({ updated: true, version: 1 })
    expect(await adapters.registry.recordChannelUpdate({ senderId: '5', status: 'available', updateId: 11, observedAt: Date.parse(now) })).toMatchObject({ updated: true, state: 'available', version: 2 })
    expect(await adapters.registry.recordChannelUpdate({ senderId: '5', status: 'blocked', updateId: 9, observedAt: Date.parse(now) + 10_000 })).toMatchObject({ updated: false })
    expect(await adapters.registry.markChannelUnavailable({ senderId: '5', attemptStartedAt: Date.parse(now) - 1, expectedVersion: 1 })).toMatchObject({ applied: false, state: 'available', version: 2 })
    expect(await adapters.registry.markChannelUnavailable({ senderId: '5', attemptStartedAt: Date.parse(now), expectedVersion: 2 })).toMatchObject({ applied: true, state: 'unavailable', version: 3 })
    expect(await adapters.channel.getState('5')).toMatchObject({ status: 'unavailable', version: 3 })
    expect((await db.doc('telegramBotAccounts/5').get()).data().status).toBe('registered')
  })

  it('redeems a short Telegram pairing code once for an active PETR parent and child', async () => {
    const db = new FakeFirestore()
    const adapters = createFirestoreAdapters(db)
    const identity = new IdentityService({ registry: adapters.registry, clock: () => new Date(now) })
    const { pairingCode } = await identity.start({ senderId: 12345, chatType: 'private', updateId: 1, occurredAt: now })
    db.records.set('families/family-a', { active: true })
    db.records.set('families/family-a/members/parent-a', { active: true, role: 'parent', childIds: ['child-a'] })
    db.records.set('families/family-a/children/child-a', { active: true })
    const challenge = [...db.records.entries()].find(([path]) => path.startsWith('telegramBotPairChallenges/'))
    expect(challenge).toBeTruthy()
    const tokenHash = challenge[0].split('/').at(-1)
    expect(tokenHash).not.toBe(pairingCode)
    await expect(identity.redeemPairing({ pairingCode, familyId: 'family-a', personId: 'parent-a' })).resolves.toEqual({ code: 'linked' })
    const link = [...db.records.entries()].find(([path, value]) => path.startsWith('telegramBotFamilyLinks/') && value.status === 'active')
    expect(link?.[1]).toMatchObject({ telegramUserId: '12345', familyId: 'family-a', personId: 'parent-a', verifiedBy: 'operator_pairing' })
    expect(db.records.get(challenge[0]).usedAt).toBe(now)
    await expect(identity.redeemPairing({ pairingCode, familyId: 'family-a', personId: 'parent-a' })).resolves.toEqual({ code: 'invalid_pairing' })
  })

  it('atomically rate-limits concurrent Start codes and rejects challenges without valid expiry metadata', async () => {
    const db = new FakeFirestore()
    const adapters = createFirestoreAdapters(db)
    const identity = new IdentityService({ registry: adapters.registry, clock: () => new Date(now) })
    const results = await Promise.all(Array.from({ length: 5 }, () => identity.start({ senderId: 12345, chatType: 'private', updateId: 1, occurredAt: now })))
    expect(results.filter((result) => result.code === 'pairing_required')).toHaveLength(1)
    expect(results.filter((result) => result.code === 'pairing_rate_limited')).toHaveLength(4)
    const account = db.records.get('telegramBotAccounts/12345')
    const hash = 'f'.repeat(64)
    db.records.set(`telegramBotPairChallenges/${hash}`, { action: 'link-family', senderId: '12345', usedAt: null, issuedAt: now })
    account.currentPairCodeHash = hash
    await expect(adapters.registry.redeemPairChallenge({ tokenHash: hash, familyId: 'family-a', personId: 'parent-a', now })).resolves.toEqual({ code: 'invalid_pairing' })
  })

  it('can claim a probe job by exact ID without claiming unrelated outbox work', async () => {
    const db = new FakeFirestore()
    const adapters = createFirestoreAdapters(db)
    db.records.set('telegramNotificationOutbox/probe-job', { jobId: 'probe-job', state: 'pending', nextAttemptAt: now, attempts: 0 })
    db.records.set('telegramNotificationOutbox/unrelated-job', { jobId: 'unrelated-job', state: 'pending', nextAttemptAt: now, attempts: 0 })
    const claimed = await adapters.outbox.claim({ workerId: 'probe', now, leaseMs: 10_000, jobId: 'probe-job' })
    expect(claimed.jobId).toBe('probe-job')
    expect(db.records.get('telegramNotificationOutbox/unrelated-job').state).toBe('pending')
    await expect(adapters.outbox.claim({ workerId: 'probe', now, leaseMs: 10_000, jobId: '../unrelated-job' })).rejects.toMatchObject({ safeCode: 'job_unavailable' })
  })

  it('accepts Telegram update_id reset only after a week of trusted update time', async () => {
    const week = 7 * 24 * 60 * 60_000
    const timestamp = Date.parse(now)
    const memory = createMemoryStore()
    await memory.registry.registerAccount({ senderId: '5', username: '', firstName: '', at: now })
    await memory.registry.recordChannelUpdate({ senderId: '5', status: 'blocked', updateId: 500, observedAt: timestamp })
    expect(await memory.registry.recordChannelUpdate({ senderId: '5', status: 'available', updateId: 1, observedAt: timestamp + week - 1 })).toMatchObject({ updated: false })
    expect(await memory.registry.recordChannelUpdate({ senderId: '5', status: 'available', updateId: 1, observedAt: timestamp + week })).toMatchObject({ updated: true, state: 'available' })

    const db = new FakeFirestore()
    const firestore = createFirestoreAdapters(db)
    await firestore.registry.registerAccount({ senderId: '5', username: '', firstName: '', at: now })
    await firestore.registry.recordChannelUpdate({ senderId: '5', status: 'blocked', updateId: 500, observedAt: timestamp })
    expect(await firestore.registry.recordChannelUpdate({ senderId: '5', status: 'available', updateId: 1, observedAt: timestamp + week - 1 })).toMatchObject({ updated: false })
    expect(await firestore.registry.recordChannelUpdate({ senderId: '5', status: 'available', updateId: 1, observedAt: timestamp + week })).toMatchObject({ updated: true, state: 'available' })
  })

  it('registers first-seen authenticated membership updates without touching family links', async () => {
    const firestoreDb = new FakeFirestore()
    const memoryStore = createMemoryStore()
    const cases = [
      { store: memoryStore, readAccount: (id) => memoryStore.accounts.get(id) },
      { store: createFirestoreAdapters(firestoreDb), readAccount: async (id) => (await firestoreDb.doc(`telegramBotAccounts/${id}`).get()).data() },
    ]
    for (const { store, readAccount } of cases) {
      const registry = store.registry
      const identity = new IdentityService({ registry, clock: () => new Date(now) })
      await identity.observeChannelMembership({ senderId: 77, chatId: 77, actorId: 77, chatType: 'private', botUserId: 99, expectedBotUserId: 99, updateId: 1, occurredAt: now, status: 'blocked' })
      expect(await store.channel.getState('77')).toMatchObject({ status: 'blocked', exists: true })
      expect(await registry.listActiveLinks('77')).toEqual([])
      await registry.registerAccount({ senderId: '77', username: 'preserved', firstName: 'User A', at: now })
      await identity.observeChannelMembership({ senderId: 77, chatId: 77, actorId: 77, chatType: 'private', botUserId: 99, expectedBotUserId: 99, updateId: 2, occurredAt: '2026-10-16T12:00:01.000Z', status: 'available' })
      const account = await readAccount('77')
      expect(account).toMatchObject({ username: 'preserved', firstName: 'User A', status: 'registered' })
    }
  })

  it('keeps a newer explicit channel confirmation when an earlier send failure returns 403', async () => {
    const store = createMemoryStore()
    await store.registry.registerAccount({ senderId: '5', username: '', firstName: '', at: now })
    const started = await store.channel.getState('5')
    await store.channel.confirmReachable({ senderId: '5', updateId: 10, observedAt: Date.parse(now) + 2_000 })
    const staleFailure = await store.channel.markUnavailable({ senderId: '5', attemptStartedAt: Date.parse(now) + 1_000, expectedVersion: started.version })
    expect(staleFailure).toMatchObject({ applied: false, state: 'available' })
    expect(await store.channel.getState('5')).toMatchObject({ status: 'available', version: 1 })
  })

  it('treats a missing channel state on legacy accounts as available but a missing account as unavailable', async () => {
    const store = createMemoryStore()
    await store.registry.registerAccount({ senderId: '5', username: '', firstName: '', at: now })
    expect(await store.channel.isAvailable('5')).toBe(true)
    expect(await store.channel.isAvailable('6')).toBe(false)
  })

  it('sets the first complete snapshot as baseline and does not advance on partial input', () => {
    const first = { complete: true, observationSequence: 1, records: [{ recordKey: 'g1', kind: 'grade', fields: { value: '5' } }] }
    const seeded = diffCompleteSnapshots({ source: 'mesh', scopeKey: 's', familyId: 'f', childId: 'c', current: first, detectedAt: now })
    expect(seeded.events).toHaveLength(0)
    expect(seeded.advanced).toBe(true)
    expect(seeded.baseline).toBe(first)
    const partial = { complete: false, observationSequence: 2, records: [] }
    const rejected = diffCompleteSnapshots({ source: 'mesh', scopeKey: 's', familyId: 'f', childId: 'c', previous: first, current: partial, detectedAt: now })
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

  it('treats a validated source semantic hash as a stable diff input without storing raw source details', () => {
    const snap = (seq, semanticHash) => ({ complete: true, observationSequence: seq, records: [{ recordKey: 'review-a', kind: 'review', eventType: 'review.changed', semanticHash, fields: { status: 'verified' } }] })
    const call = (previous, current) => diffCompleteSnapshots({ source: 'firestore', scopeKey: 's', familyId: 'f', childId: 'c', previous, current, detectedAt: now })
    const first = snap(1, 'a'.repeat(64))
    expect(call(first, snap(2, 'a'.repeat(64))).events).toEqual([])
    const changed = call(first, snap(2, 'b'.repeat(64)))
    expect(changed.events).toHaveLength(1)
    expect(changed.events[0]).toMatchObject({ eventType: 'review.changed', fields: {} })
    expect(call(first, snap(2, 'not-a-hash')).advanced).toBe(false)
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

  it('correlates separate acceptance and delivery traces with event ID and opaque job hash', async () => {
    const exported = []
    const telemetry = createTelemetry({ sink: (row) => { if (row.kind === 'span') exported.push(row) } })
    const store = createMemoryStore()
    store.addActiveLink({ linkId: 'private-link', familyId: 'family-a', personId: 'person-a', telegramUserId: '5512345' })
    const service = new NotificationService({ eventLedger: store.eventLedger, outbox: store.outbox,
      recipients: { async resolveVerified() { return [{ type: 'family-link', linkId: 'private-link', familyId: 'family-a', personId: 'person-a', telegramUserId: '5512345' }] } },
      membership: { async isActiveMember() { return true } }, renderer: renderEvent,
      delivery: { async send() { return { messageId: 19 } } }, telemetry,
      clock: () => new Date(now), workerId: 'telemetry-test', logger: { info() {}, error() {} },
    })
    const item = event()
    await telemetry.trace('telegram.notification.accept', () => service.accept(item), { eventId: item.eventId })
    await telemetry.trace('telegram.notification.run-one', () => service.runOne(), { eventId: item.eventId })
    const accept = exported.find((span) => span.operation === 'telegram.notification.accept')
    const run = exported.find((span) => span.operation === 'telegram.notification.run-one')
    const job = exported.find((span) => span.operation === 'telegram.notification.job')
    expect(accept.attributes.eventId).toBe(item.eventId)
    expect(run.attributes.eventId).toBe(item.eventId)
    expect(job.attributes).toEqual({ eventId: item.eventId,
      jobId: createHash('sha256').update(`${item.eventId}_private-link`).digest('hex') })
    expect(accept.traceId).not.toBe(job.traceId)
    const output = JSON.stringify(exported)
    expect(output).not.toContain('private-link')
    expect(output).not.toContain('5512345')
    expect(output).not.toContain('Ученик А')
  })

  it('does not send when the independent channel gate knows the account is unavailable', async () => {
    const store = createMemoryStore()
    await store.registry.registerAccount({ senderId: '5', username: '', firstName: '', at: now })
    store.addActiveLink({ linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' })
    await store.channel.setStatusForTest('5', 'unavailable', Date.parse(now))
    let sends = 0
    const service = new NotificationService({ eventLedger: store.eventLedger, outbox: store.outbox,
      recipients: { async resolveVerified() { return [{ type: 'family-link', linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' }] } },
      membership: { async isActiveMember() { return true } }, channel: store.channel,
      renderer: renderEvent, delivery: { async send() { sends += 1; return { messageId: 1 } } },
      clock: () => new Date(now), workerId: 'channel-gate', logger: { info() {}, error() {} },
    })
    await service.accept(event())
    await service.runOne()
    expect(sends).toBe(0)
    expect([...store.jobs.values()][0]).toMatchObject({ state: 'blocked', safeErrorCode: 'channel_unavailable' })
    expect(store.links.get('link-a').status).toBe('active')
  })

  it('keeps a job retryable when the channel state store is temporarily unavailable', async () => {
    const store = createMemoryStore()
    store.addActiveLink({ linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' })
    const service = new NotificationService({ eventLedger: store.eventLedger, outbox: store.outbox,
      recipients: { async resolveVerified() { return [{ type: 'family-link', linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' }] } },
      membership: { async isActiveMember() { return true } }, channel: { async getState() { throw new Error('private-db-detail') }, async markUnavailable() { return { applied: false } } },
      renderer: renderEvent, delivery: { async send() { throw new Error('must_not_send') } }, clock: () => new Date(now), workerId: 'channel-read', logger: { info() {}, error() {} },
    })
    await service.accept(event())
    await service.runOne()
    expect([...store.jobs.values()][0]).toMatchObject({ state: 'retry_wait', safeErrorCode: 'channel_state_unavailable' })
    expect(JSON.stringify([...store.jobs.values()])).not.toContain('private-db-detail')
  })

  it('leaves a job for lease recovery when persisting a 403 channel marker fails', async () => {
    const store = createMemoryStore()
    await store.registry.registerAccount({ senderId: '5', username: '', firstName: '', at: now })
    store.addActiveLink({ linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' })
    const service = new NotificationService({ eventLedger: store.eventLedger, outbox: store.outbox,
      recipients: { async resolveVerified() { return [{ type: 'family-link', linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' }] } },
      membership: { async isActiveMember() { return true } }, channel: { async getState() { return { status: 'available', version: 0 } }, async markUnavailable() { throw new Error('private-write-detail') } },
      renderer: renderEvent, delivery: { async send() { throw Object.assign(new Error(), { safeCode: 'channel_unavailable' }) } },
      clock: () => new Date(now), workerId: 'channel-write', logger: { info() {}, error() {} },
    })
    await service.accept(event())
    await expect(service.runOne()).rejects.toThrow('private-write-detail')
    expect([...store.jobs.values()][0].state).toBe('leased')
    await store.outbox.recoverExpired(new Date(Date.parse(now) + 121_000).toISOString())
    expect([...store.jobs.values()][0]).toMatchObject({ state: 'retry_wait', safeErrorCode: 'worker_lease_expired' })
  })

  it('does not let a late 403 overwrite a newer channel update and retries the current job', async () => {
    const store = createMemoryStore()
    await store.registry.registerAccount({ senderId: '5', username: '', firstName: '', at: now })
    store.addActiveLink({ linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' })
    let rejectSend
    const service = new NotificationService({ eventLedger: store.eventLedger, outbox: store.outbox,
      recipients: { async resolveVerified() { return [{ type: 'family-link', linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' }] } },
      membership: { async isActiveMember() { return true } }, channel: store.channel,
      renderer: renderEvent, delivery: { send() { return new Promise((_, reject) => { rejectSend = reject }) } },
      clock: () => new Date(now), workerId: 'late-403', logger: { info() {}, error() {} },
    })
    await service.accept(event())
    const running = service.runOne()
    while (!rejectSend) await new Promise((resolve) => setTimeout(resolve, 0))
    await store.channel.confirmReachable({ senderId: '5', updateId: 11, observedAt: Date.parse(now) + 2_000 })
    const forbidden = Object.assign(new Error('forbidden'), { safeCode: 'channel_unavailable' })
    rejectSend(forbidden)
    await running
    expect(await store.channel.getState('5')).toMatchObject({ status: 'available', version: 1 })
    expect([...store.jobs.values()][0]).toMatchObject({ state: 'retry_wait', safeErrorCode: 'channel_state_changed' })
    expect(store.links.get('link-a').status).toBe('active')
  })

  it('returns the actual count of newly created jobs for memory and Firestore ledger adapters', async () => {
    const memory = createMemoryStore()
    const memoryEvent = event()
    const existing = { jobId: `${memoryEvent.eventId}_link-a`, eventId: memoryEvent.eventId, linkId: 'link-a', familyId: 'family-a', personId: 'person-a', childId: 'child-a', telegramUserId: '5', state: 'pending', attempts: 0, nextAttemptAt: now }
    memory.jobs.set(existing.jobId, existing)
    await memory.registry.registerAccount({ senderId: '5', username: '', firstName: '', at: now })
    memory.addActiveLink({ linkId: 'link-a', familyId: 'family-a', personId: 'person-a', telegramUserId: '5' })
    const memoryResult = await memory.eventLedger.recordIfAbsent({ event: memoryEvent, jobs: [existing] })
    expect(memoryResult.queued).toBe(0)

    const db = new FakeFirestore()
    const adapters = createFirestoreAdapters(db)
    await db.doc('telegramBotFamilyLinks/link-a').set({ familyId: 'family-a', personId: 'person-a', telegramUserId: '5', status: 'active' })
    await db.doc('families/family-a/members/person-a').set({ active: true, role: 'parent', childIds: ['child-a'] })
    await db.doc(`telegramNotificationOutbox/${existing.jobId}`).set(existing)
    const firestoreResult = await adapters.eventLedger.recordIfAbsent({ event: memoryEvent, jobs: [existing] })
    expect(firestoreResult.queued).toBe(0)
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
      constructor(token, options) { calls.push(['bot', token, options]); this.api = { config: { use() {} } }; this.handlers = {} }
      command(name, callback) { this.handlers[`command:${name}`] = callback }
      on(name, callback) { this.handlers[`on:${name}`] = callback }
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
    class ForbiddenApi extends FakeApi { async sendMessage() { throw { error_code: 403 } } }
    await expect(createTelegramDelivery('test-only', { ApiClass: ForbiddenApi }).send({ chatId: 1, text: 'x' })).rejects.toMatchObject({ safeCode: 'channel_unavailable' })
  })

  it('wires Telegram start metadata and authentic private my_chat_member updates to channel state', async () => {
    const captured = { starts: [], membership: [] }
    const identity = {
      async start(input) { captured.starts.push(input); return { code: 'registered' } },
      async observeChannelMembership(input) { captured.membership.push(input); return { updated: true } },
      async requestStop() {}, async confirmStop() {},
    }
    let bot
    class FakeBot {
      constructor() { this.api = { config: { use() {} } }; this.handlers = {} ; bot = this }
      command(name, callback) { this.handlers[`command:${name}`] = callback }
      on(name, callback) { this.handlers[`on:${name}`] = callback }
      callbackQuery() {} catch() {} async start() {} async stop() {}
    }
    createTelegramAdapter({ token: 'test-only', identity, BotClass: FakeBot })
    await bot.handlers['command:start']({ chat: { type: 'private' }, from: { id: 5 }, update: { update_id: 8 }, message: { date: 1_792_153_200 }, match: '', reply() {} })
    await bot.handlers['on:my_chat_member']({ chat: { type: 'private' }, from: { id: 5 }, me: { id: 99 }, update: { update_id: 9 }, myChatMember: { date: 1_792_153_201, chat: { id: 5, type: 'private' }, from: { id: 5 }, new_chat_member: { status: 'kicked', user: { id: 99 } } } })
    expect(captured.starts[0]).toMatchObject({ senderId: 5, updateId: 8, occurredAt: new Date(1_792_153_200_000).toISOString() })
    expect(captured.membership[0]).toMatchObject({ senderId: 5, chatId: 5, actorId: 5, botUserId: 99, expectedBotUserId: 99, updateId: 9, status: 'blocked' })
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
      delete: (ref) => ref.delete(),
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
  async delete() { this.db.records.delete(this.path) }
}
class FakeDocumentSnapshot {
  constructor(ref, data) { this.ref = ref; this.id = ref.id; this.exists = data !== undefined; this._data = data }
  data() { return this._data }
}
