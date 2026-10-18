/* @see ../../../docs/decisions/telegram-compact-digest-2026-10-18.md */
import { Api, Bot, HttpError, InlineKeyboard } from 'grammy'
import { autoRetry } from '@grammyjs/auto-retry'

/** @see ../../../docs/services/telegram-bot/delivery.md#telegram-formatting-и-частичные-ошибки @see ../../../docs/services/telegram-bot/identity-and-linking.md#отключение @see ../../../docs/services/telegram-bot/operations.md#runtime-boundary */
export function createTelegramAdapter({ token, identity, logger = { error() {} }, BotClass = Bot, ApiClass = Api }) {
  const bot = new BotClass(token, { client: { timeoutSeconds: 20 } })
  bot.api.config.use(autoRetry({ maxRetryAttempts: 1, maxDelaySeconds: 2, rethrowHttpErrors: true, rethrowInternalServerErrors: true }))
  bot.command('start', async (ctx) => {
    if (ctx.chat?.type !== 'private') return
    try {
      const result = await identity.start({ senderId: ctx.from.id, chatType: ctx.chat.type, username: ctx.from.username, firstName: ctx.from.first_name, startToken: ctx.match || undefined, updateId: ctx.update.update_id, occurredAt: new Date(ctx.message.date * 1000).toISOString() })
      if (result.code === 'pairing_required') {
        return ctx.reply(`Telegram зарегистрирован. Одноразовый код привязки: ${result.pairingCode}. Передайте его оператору PETR для подтверждения семейной связи. Код действует 10 минут.`)
      }
      if (result.code === 'pairing_rate_limited') return ctx.reply('Новый код можно запросить через минуту. Повторите /start позже.')
      return ctx.reply(result.code === 'linking_unavailable' || result.code === 'pairing_unavailable'
        ? 'Telegram зарегистрирован. Подключение семьи пока недоступно.'
        : 'Telegram зарегистрирован. Чтобы отключить одну семейную связь, используйте /stop.')
    } catch {
      logger.error({ code: 'start_failed' })
      return ctx.reply('Не удалось обработать команду. Повторите позже.')
    }
  })
  bot.on('my_chat_member', async (ctx) => {
    const update = ctx.myChatMember
    const status = update?.new_chat_member?.status
    const channelStatus = status === 'member' ? 'available' : status === 'kicked' ? 'blocked' : status === 'left' ? 'unavailable' : null
    if (!channelStatus) return
    try {
      await identity.observeChannelMembership({ senderId: update.from?.id, chatId: update.chat?.id, actorId: update.from?.id,
        chatType: update.chat?.type, botUserId: update.new_chat_member?.user?.id, expectedBotUserId: ctx.me?.id,
        updateId: ctx.update.update_id, occurredAt: new Date(update.date * 1000).toISOString(), status: channelStatus })
    } catch {
      logger.error({ code: 'channel_membership_update_failed' })
    }
  })
  bot.command('stop', async (ctx) => {
    if (ctx.chat?.type !== 'private') return
    try {
      const result = await identity.requestStop({ senderId: ctx.from.id, chatType: ctx.chat.type })
      if (!result.choices.length) return ctx.reply('Нет активных семейных связей.')
      const keyboard = new InlineKeyboard()
      for (const choice of result.choices) keyboard.text(`Отключить: ${choice.label}`.slice(0, 60), `stop:${choice.callbackToken}`).row()
      return ctx.reply('Подтвердите отключение одной семейной связи:', { reply_markup: keyboard })
    } catch {
      logger.error({ code: 'stop_request_failed' })
      return ctx.reply('Не удалось обработать команду. Повторите позже.')
    }
  })
  bot.callbackQuery(/^stop:([A-Za-z0-9_-]{20,60})$/, async (ctx) => {
    if (ctx.chat?.type !== 'private') return
    try {
      const result = await identity.confirmStop({ senderId: ctx.from.id, chatType: ctx.chat.type, callbackToken: ctx.match[1] })
      await ctx.answerCallbackQuery({ text: result.code === 'disconnected' ? 'Связь отключена' : 'Подтверждение истекло или недействительно' })
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } })
    } catch {
      logger.error({ code: 'stop_confirmation_failed' })
      await ctx.answerCallbackQuery({ text: 'Не удалось подтвердить. Повторите /stop.' })
    }
  })
  bot.catch(() => logger.error({ code: 'telegram_update_failed' }))
  return {
    bot,
    async verifyIdentity() {
      const me = await new ApiClass(token, { timeoutSeconds: 20 }).getMe()
      if (me.username?.toLowerCase() !== 'agi_edu_bot') throw new Error('telegram_identity_mismatch')
      return { id: me.id, username: me.username }
    },
    async start() { return bot.start({ timeout: 10 }) },
    async stop() { return bot.stop() },
  }
}

export function createTelegramDelivery(token, { ApiClass = Api } = {}) {
  const api = new ApiClass(token, { timeoutSeconds: 20 })
  api.config.use(autoRetry({ maxRetryAttempts: 1, maxDelaySeconds: 2, rethrowHttpErrors: true, rethrowInternalServerErrors: true }))
  return {
    async send({ chatId, text, part }) {
      if (part) {
        if (part.format === 'html') return await sendFallback(chatId, part, 'html')
        try {
          if (typeof api.sendRichMessage !== 'function') return await sendFallback(chatId, part)
          const message = await api.sendRichMessage(chatId, part.rich_message, {})
          return { messageId: message.message_id, method: 'sendRichMessage', format: 'rich_message' }
        } catch (cause) {
          if (unsupportedRichMessage(cause)) return await sendFallback(chatId, part)
          throw deliveryError(cause)
        }
      }
      try {
        const message = await api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } })
        return { messageId: message.message_id }
      } catch (cause) {
        throw deliveryError(cause)
      }
    },
  }

  async function sendFallback(chatId, part, format = 'html-fallback') {
    try {
      const message = await api.sendMessage(chatId, part.html, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(part.keyboard ? { reply_markup: { inline_keyboard: [part.keyboard.buttons] } } : {}) })
      return { messageId: message.message_id, method: 'sendMessage', format }
    } catch (cause) {
      throw deliveryError(cause)
    }
  }
}
function unsupportedRichMessage(error) {
  const description = String(error?.description ?? error?.message ?? '').toLowerCase()
  if (error?.error_code === 404 || error?.status === 404) return /sendrichmessage|method not found|unknown method|unsupported method/.test(description)
  if (error?.error_code !== 400 && error?.status !== 400) return false
  return /(?:method|sendrichmessage).{0,40}(?:not found|unsupported|unknown)|(?:not found|unsupported|unknown).{0,40}(?:method|sendrichmessage)/.test(description)
}

function deliveryError(cause) {
  const error = new Error('telegram_delivery_failed')
  if (cause?.error_code === 403) error.safeCode = 'channel_unavailable'
  else if (cause?.parameters?.retry_after) { error.safeCode = 'rate_limited'; error.retryAfterMs = cause.parameters.retry_after * 1000 }
  else if (cause instanceof HttpError || cause?.error_code >= 500 || cause?.status >= 500 || cause?.name === 'TimeoutError') error.safeCode = 'telegram_temporary'
  else error.safeCode = 'delivery_failed'
  return error
}
