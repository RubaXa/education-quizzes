import { describe, expect, it } from 'vitest'
import { IdentityService, hash } from './application/identity.mjs'
import { createMemoryStore } from './adapters/memory.mjs'

describe('sender-bound Telegram pairing challenge', () => {
  it('issues a private short-lived code but stores only its hash', async () => {
    const store = createMemoryStore()
    const identity = new IdentityService({ registry: store.registry, clock: () => new Date('2026-10-17T10:00:00.000Z') })
    const result = await identity.start({ senderId: 1234, chatType: 'private' })
    expect(result).toMatchObject({ code: 'pairing_required', expiresAt: '2026-10-17T10:10:00.000Z' })
    expect(result.pairingCode).toMatch(/^[a-f0-9]{16}$/)
    expect(store.pairChallenges.get(hash(result.pairingCode))).toMatchObject({ senderId: '1234', expiresAt: result.expiresAt })
    expect([...store.pairChallenges.values()].some((row) => row.pairingCode)).toBe(false)
  })

  it('keeps an issued code redeemable when the injected clock advances between calls', async () => {
    const store = createMemoryStore()
    let ticks = 0
    const base = Date.parse('2026-10-17T10:00:00.000Z')
    const identity = new IdentityService({ registry: store.registry, clock: () => new Date(base + ticks++ ) })
    const result = await identity.start({ senderId: 4321, chatType: 'private' })
    const challenge = store.pairChallenges.get(hash(result.pairingCode))
    expect(Date.parse(challenge.expiresAt) - Date.parse(challenge.issuedAt)).toBe(600_000)
    await expect(identity.redeemPairing({ pairingCode: result.pairingCode, familyId: 'family-a', personId: 'parent-a' }))
      .resolves.toEqual({ code: 'linked' })
  })

  it('redeems once and rejects malformed, expired, or reused codes', async () => {
    const store = createMemoryStore()
    let instant = new Date('2026-10-17T10:00:00.000Z')
    const identity = new IdentityService({ registry: store.registry, clock: () => instant })
    const { pairingCode } = await identity.start({ senderId: 1234, chatType: 'private' })
    await expect(identity.redeemPairing({ pairingCode, familyId: 'family-a', personId: 'parent-a' })).resolves.toEqual({ code: 'linked' })
    await expect(identity.redeemPairing({ pairingCode, familyId: 'family-a', personId: 'parent-a' })).resolves.toEqual({ code: 'invalid_pairing' })
    await expect(identity.redeemPairing({ pairingCode: 'not-a-code', familyId: 'family-a', personId: 'parent-a' })).resolves.toEqual({ code: 'invalid_pairing' })
    instant = new Date('2026-10-17T10:01:00.000Z')
    const second = await identity.start({ senderId: 5678, chatType: 'private' })
    instant = new Date('2026-10-17T10:11:00.000Z')
    await expect(identity.redeemPairing({ pairingCode: second.pairingCode, familyId: 'family-a', personId: 'parent-a' })).resolves.toEqual({ code: 'invalid_pairing' })
  })

  it('rate-limits issuance and invalidates the previous code when a new one is issued', async () => {
    const store = createMemoryStore()
    let instant = new Date('2026-10-17T10:00:00.000Z')
    const identity = new IdentityService({ registry: store.registry, clock: () => instant })
    const first = await identity.start({ senderId: 1234, chatType: 'private' })
    instant = new Date('2026-10-17T10:00:30.000Z')
    const tooSoon = await identity.start({ senderId: 1234, chatType: 'private' })
    expect(tooSoon).toEqual({ code: 'pairing_rate_limited' })
    instant = new Date('2026-10-17T10:01:00.000Z')
    const second = await identity.start({ senderId: 1234, chatType: 'private' })
    expect(second.code).toBe('pairing_required')
    expect(store.pairChallenges.has(hash(first.pairingCode))).toBe(false)
    await expect(identity.redeemPairing({ pairingCode: first.pairingCode, familyId: 'family-a', personId: 'parent-a' })).resolves.toEqual({ code: 'invalid_pairing' })
  })

  it('allows only one active person link per sender and family', async () => {
    const store = createMemoryStore()
    let instant = new Date('2026-10-17T10:00:00.000Z')
    const identity = new IdentityService({ registry: store.registry, clock: () => instant })
    const first = await identity.start({ senderId: 1234, chatType: 'private' })
    await expect(identity.redeemPairing({ pairingCode: first.pairingCode, familyId: 'family-a', personId: 'parent-a' })).resolves.toEqual({ code: 'linked' })
    store.addActiveLink({ linkId: 'legacy-opaque', telegramUserId: '1234', familyId: 'family-b', personId: 'parent-b' })
    const second = await identity.start({ senderId: 1234, chatType: 'private' })
    expect(second.code).toBe('registered')
    instant = new Date('2026-10-17T10:01:00.000Z')
    const conflictingCode = 'fedcba9876543210'
    await store.registry.createPairChallenge({ tokenHash: hash(conflictingCode), senderId: '1234', issuedAt: instant.toISOString(), expiresAt: new Date(instant.valueOf() + 600_000).toISOString() })
    await expect(identity.redeemPairing({ pairingCode: conflictingCode, familyId: 'family-a', personId: 'parent-other' })).resolves.toEqual({ code: 'pairing_conflict' })
  })

  it('does not expose a code for non-private Start or an account with an active link', async () => {
    const store = createMemoryStore()
    const identity = new IdentityService({ registry: store.registry })
    await expect(identity.start({ senderId: 1234, chatType: 'group' })).rejects.toThrow('private_chat_required')
    store.addActiveLink({ linkId: 'existing', telegramUserId: '1234', familyId: 'family-a', personId: 'parent-a' })
    await expect(identity.start({ senderId: 1234, chatType: 'private' })).resolves.toEqual({ code: 'registered' })
    expect(store.pairChallenges.size).toBe(0)
  })
})
