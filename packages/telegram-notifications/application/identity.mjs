import { createHash, randomBytes } from 'node:crypto'
import { assertPort } from '../domain/ports.mjs'

/** @see ../../../docs/services/telegram-bot/identity-and-linking.md#отключение @see ../../../docs/services/telegram-bot/identity-and-linking.md#состояния @see ../../../docs/services/telegram-bot/ports-and-events.md#контракт-портов */
export class IdentityService {
  constructor({ registry, linkAuthorizer = null, clock = () => new Date(), confirmationTtlMs = 5 * 60_000 }) {
    this.registry = assertPort(registry, ['registerAccount', 'listActiveLinks', 'createStopChallenge', 'consumeStopChallenge', 'recordChannelUpdate'])
    this.linkAuthorizer = linkAuthorizer
    this.clock = clock
    this.confirmationTtlMs = confirmationTtlMs
  }

  async start({ senderId, chatType, username, firstName, startToken, updateId, occurredAt }) {
    requirePrivate(senderId, chatType)
    requireTelegramId(senderId)
    await this.registry.registerAccount({ senderId: String(senderId), username: safeMeta(username), firstName: safeMeta(firstName), at: this.clock().toISOString() })
    if (Number.isSafeInteger(updateId) && Number.isSafeInteger(Date.parse(occurredAt))) await this.registry.recordChannelUpdate({ senderId: String(senderId), status: 'available', updateId, observedAt: Date.parse(occurredAt) })
    if (startToken && this.linkAuthorizer) {
      await this.linkAuthorizer.redeem({ token: startToken, telegramUserId: String(senderId), at: this.clock().toISOString() })
    }
    if (startToken && !this.linkAuthorizer) return { code: 'linking_unavailable' }
    const links = await this.registry.listActiveLinks(String(senderId))
    if (links.length) return { code: 'registered' }
    if (!this.registry.createPairChallenge) return { code: 'pairing_unavailable' }
    const pairingCode = randomBytes(8).toString('hex')
    const issuedAt = this.clock().toISOString()
    const expiresAt = new Date(Date.parse(issuedAt) + 10 * 60_000).toISOString()
    const challenge = await this.registry.createPairChallenge({ tokenHash: hash(pairingCode), senderId: String(senderId), expiresAt, issuedAt })
    if (challenge?.issued !== true) return { code: 'pairing_rate_limited' }
    return { code: 'pairing_required', pairingCode, expiresAt }
  }

  async observeChannelMembership({ senderId, chatId, actorId, chatType, botUserId, expectedBotUserId, updateId, occurredAt, status }) {
    if (chatType !== 'private' || String(senderId) !== String(chatId) || String(senderId) !== String(actorId)
      || !validTelegramId(botUserId) || !validTelegramId(expectedBotUserId) || String(botUserId) !== String(expectedBotUserId) || !Number.isSafeInteger(updateId)
      || !Number.isSafeInteger(Date.parse(occurredAt)) || !['available', 'unavailable', 'blocked'].includes(status)) return { updated: false }
    requireTelegramId(senderId)
    if (!this.registry.recordChannelUpdate) return { updated: false }
    return this.registry.recordChannelUpdate({ senderId: String(senderId), status, updateId, observedAt: Date.parse(occurredAt) })
  }

  async requestStop({ senderId, chatType }) {
    requirePrivate(senderId, chatType)
    requireTelegramId(senderId)
    const links = await this.registry.listActiveLinks(String(senderId))
    if (!links.length) return { code: 'no_active_links', choices: [] }
    const choices = []
    for (const link of links) {
      const token = randomBytes(32).toString('base64url')
      const expiresAt = new Date(this.clock().valueOf() + this.confirmationTtlMs).toISOString()
      await this.registry.createStopChallenge({ tokenHash: hash(token), senderId: String(senderId), linkId: link.linkId, familyId: link.familyId, expiresAt })
      choices.push({ linkId: link.linkId, label: safeMeta(link.label) || 'Семейная связь', callbackToken: token })
    }
    return { code: 'confirmation_required', choices }
  }

  async confirmStop({ senderId, chatType, callbackToken }) {
    requirePrivate(senderId, chatType)
    requireTelegramId(senderId)
    if (typeof callbackToken !== 'string' || callbackToken.length > 100) return { code: 'invalid_confirmation' }
    const result = await this.registry.consumeStopChallenge({ tokenHash: hash(callbackToken), senderId: String(senderId), now: this.clock().toISOString() })
    return { code: result.code }
  }

  async redeemPairing({ pairingCode, familyId, personId }) {
    if (typeof pairingCode !== 'string' || !/^[a-f0-9]{16}$/.test(pairingCode)
      || !validLocalId(familyId) || !validLocalId(personId)) return { code: 'invalid_pairing' }
    if (!this.registry.redeemPairChallenge) return { code: 'pairing_unavailable' }
    const result = await this.registry.redeemPairChallenge({ tokenHash: hash(pairingCode), familyId, personId, now: this.clock().toISOString() })
    return { code: result.code }
  }
}

export const hash = (token) => createHash('sha256').update(token).digest('hex')

function requirePrivate(senderId, chatType) {
  if (senderId === undefined || senderId === null || chatType !== 'private') throw new Error('private_chat_required')
}
function validTelegramId(value) { return Number.isSafeInteger(Number(value)) && Number(value) > 0 }
function requireTelegramId(senderId) { if (!validTelegramId(senderId)) throw new Error('invalid_sender') }
function validLocalId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }
function safeMeta(value) {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex -- Strip control bytes from Telegram profile metadata before storing it.
  return value.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 80)
}
