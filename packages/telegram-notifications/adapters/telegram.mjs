import { Api, Bot, HttpError, InlineKeyboard } from 'grammy'
import { autoRetry } from '@grammyjs/auto-retry'

/** @see ../../../docs/services/telegram-bot/delivery.md#telegram-formatting-и-частичные-ошибки @see ../../../docs/services/telegram-bot/identity-and-linking.md#отключение @see ../../../docs/services/telegram-bot/operations.md#runtime-boundary */
export function createTelegramAdapter({ token, identity, logger = { error() {} }, BotClass = Bot, ApiClass = Api }) {
  const bot = new BotClass(token, { client: { timeoutSeconds: 20 } })
  bot.api.config.use(autoRetry({ maxRetryAttempts: 1, maxDelaySeconds: 2, rethrowHttpErrors: true, rethrowInternalServerErrors: true }))
  bot.command('start', async (ctx) => {
    if (ctx.chat?.type !== 'private') return
    try {
      const result = await identity.start({ senderId: ctx.from.id, chatType: ctx.chat.type, username: ctx.from.username, firstName: ctx.from.first_name, startToken: ctx.match || undefined })
      return ctx.reply(result.code === 'linking_unavailable'
        ? 'Telegram зарегистрирован. Подключение семьи пока недоступно.'
        : 'Telegram зарегистрирован. Чтобы отключить одну семейную связь, используйте /stop.')
    } catch {
      logger.error({ code: 'start_failed' })
      return ctx.reply('Не удалось обработать команду. Повторите позже.')
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
    async send({ chatId, text }) {
      try {
        const message = await api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } })
        return { messageId: message.message_id }
      } catch (cause) {
        const error = new Error('telegram_delivery_failed')
        if (cause?.error_code === 403) error.safeCode = 'recipient_blocked'
        else if (cause?.parameters?.retry_after) { error.safeCode = 'rate_limited'; error.retryAfterMs = cause.parameters.retry_after * 1000 }
        else if (cause instanceof HttpError || cause?.error_code >= 500) error.safeCode = 'telegram_temporary'
        else error.safeCode = 'delivery_failed'
        throw error
      }
    },
  }
}
