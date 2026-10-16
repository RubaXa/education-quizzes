import { createHash, randomBytes } from 'node:crypto'
import { assertPort } from '../domain/ports.mjs'

/** @see ../../../docs/services/telegram-bot/identity-and-linking.md#отключение */
export class IdentityService {
  constructor({ registry, linkAuthorizer = null, clock = () => new Date(), confirmationTtlMs = 5 * 60_000 }) {
    this.registry = assertPort(registry, ['registerAccount', 'listActiveLinks', 'createStopChallenge', 'consumeStopChallenge'])
    this.linkAuthorizer = linkAuthorizer
    this.clock = clock
    this.confirmationTtlMs = confirmationTtlMs
  }

  async start({ senderId, chatType, username, firstName, startToken }) {
    requirePrivate(senderId, chatType)
    requireTelegramId(senderId)
    await this.registry.registerAccount({ senderId: String(senderId), username: safeMeta(username), firstName: safeMeta(firstName), at: this.clock().toISOString() })
    if (startToken && this.linkAuthorizer) {
      await this.linkAuthorizer.redeem({ token: startToken, telegramUserId: String(senderId), at: this.clock().toISOString() })
    }
    return { code: startToken && !this.linkAuthorizer ? 'linking_unavailable' : 'registered' }
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
}

export const hash = (token) => createHash('sha256').update(token).digest('hex')

function requirePrivate(senderId, chatType) {
  if (senderId === undefined || senderId === null || chatType !== 'private') throw new Error('private_chat_required')
}
function requireTelegramId(senderId) {
  if (!Number.isSafeInteger(Number(senderId)) || Number(senderId) <= 0) throw new Error('invalid_sender')
}
function safeMeta(value) {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex -- Strip control bytes from Telegram profile metadata before storing it.
  return value.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 80)
}
