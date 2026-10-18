/* @see ../../../docs/decisions/telegram-compact-digest-2026-10-18.md */
/** @see ../../../docs/services/telegram-bot/delivery.md#структурный-вид */
import { getNotificationPresentation, getNotificationDigestPresentation, validateNotificationAction, isValidWorkRef, isValidWorkOrder } from '../../education-presentation/notification.mjs'

const LABELS = Object.freeze({
  'schedule.created': 'Добавлено расписание', 'schedule.changed': 'Изменено расписание', 'schedule.cancelled': 'Расписание отменено',
  'homework.assigned': 'Назначено ДЗ', 'homework.changed': 'Изменено ДЗ', 'homework.cancelled': 'ДЗ отменено',
  'grade.created': 'Новая оценка', 'grade.changed': 'Изменена оценка', 'upload.confirmed': 'Загружено фото работы',
  'quiz.started': 'Тест начат', 'quiz.submitted': 'Тест отправлен', 'review.changed': 'Обновлена проверка',
  'technical.probe': 'Техническая проверка уведомлений',
})

export function renderEvent(event, audience, { maxChars = 3900 } = {}) {
  if (!['family', 'team'].includes(audience)) throw new Error('invalid_audience')
  if (!Object.hasOwn(LABELS, event.eventType) || event.privacyClass === 'restricted') return []
  if (event.eventType === 'technical.probe') {
    if (audience !== 'family' || event.privacyClass !== 'family-summary') return []
    return ['Education: техническая проверка уведомлений. Это служебное сообщение; учебные данные не использовались.']
  }
  if (audience === 'family' && event.privacyClass !== 'family-summary') return []
  if (audience === 'team' && event.privacyClass !== 'team-summary') return []
  const fields = event.fields ?? {}
  const lines = audience === 'team'
    ? ['📚 Событие Education', `• ${LABELS[event.eventType]}`]
    : ['📚 Изменения Education', '', safeText(fields.childName) || 'Ученик',
      `• ${LABELS[event.eventType]}${safeText(fields.subject) ? `: ${safeText(fields.subject)}` : ''}`]
  if (audience === 'team') return splitText(lines.join('\n'), maxChars)
  // Never render before/after, raw payload, URLs, identifiers, or arbitrary object values.
  if (['schedule.created', 'schedule.changed', 'schedule.cancelled', 'homework.assigned', 'homework.changed', 'homework.cancelled', 'upload.confirmed'].includes(event.eventType) && safeText(fields.title)) lines.push(`  ${safeText(fields.title)}`)
  if (event.eventType.startsWith('grade.') && safeGrade(fields.value)) lines.push(`  Оценка: ${safeGrade(fields.value)}`)
  if (safeText(fields.occurredLabel)) lines.push(`  ${safeText(fields.occurredLabel)}`)
  return splitText(lines.join('\n'), maxChars)
}

/** New immutable outbox representation. Each part is plain JSON and can be replayed without rerendering. */
export function renderNotificationParts(event, audience, { maxChars = 1200, demo = false, action = null } = {}) {
  return renderNotificationDigestParts([event], audience, { maxChars, demo, action })
}

/** Compact durable digest renderer. User-facing text is ordinary HTML with explicit newlines. */
export function renderNotificationDigestParts(events, audience, { maxChars = 1200, demo = false } = {}) {
  if (!['family', 'team'].includes(audience)) throw new Error('invalid_audience')
  if (!Array.isArray(events) || !events.length || events.some((event) => !Object.hasOwn(LABELS, event.eventType)
    || event.privacyClass === 'restricted' || event.privacyClass !== 'family-summary')) return []
  if (audience !== 'family') return []
  if (events.some((event) => event.eventType === 'review.changed'
    && (!safeText(event.fields?.subject) || !safeText(event.fields?.title)))) return []
  const vm = getNotificationDigestPresentation(events)
  if (!vm) return []
  if (!Number.isInteger(maxChars) || maxChars < 100) throw new Error('invalid_message_limit')
  let header = vm.header
  let context = vm.context
  let facts = vm.entries.filter((entry) => entry.text)
  if (demo && header) header = `Пример · ${header}`
  if (events.length === 1 && events[0].eventType === 'technical.probe') {
    header = ''
    context = ''
    facts = [{ text: '🧪 Демонстрация уведомления' }, { text: 'Это служебное сообщение; учебные данные не использовались.' }]
  }
  if (demo && facts.length && !header && !(events.length === 1 && events[0].eventType === 'technical.probe')) facts[0] = { ...facts[0], text: `Пример · ${facts[0].text}` }
  const chunks = []
  let chunk = []
  let chunkLength = [...header].length + [...context].length
  for (const fact of facts) {
    const line = fact.text
    if ([...line].length > maxChars - 80) throw new Error('notification_entry_too_long')
    const extra = [...line].length + (chunk.length ? 1 : (header || context) ? 1 : 0)
    if (chunk.length && (chunk.length >= 6 || chunkLength + extra > maxChars - 50)) {
      chunks.push(chunk)
      chunk = []
      chunkLength = [...header].length + [...context].length
    }
    chunk.push(fact)
    chunkLength += extra
  }
  if (chunk.length || !chunks.length) chunks.push(chunk)
  const partCount = chunks.length
  const parts = chunks.map((factsForPart, index) => {
    const linesForPart = factsForPart.map((fact) => fact.text)
    const partHeader = partCount > 1 ? `${header ? `${header} · ` : ''}часть ${index + 1}/${partCount}` : header
    const plainText = [partHeader, context, ...linesForPart].filter(Boolean).join('\n')
    const html = `${partHeader ? `<b>${escapeHtml(partHeader)}</b>${context || linesForPart.length ? '\n' : ''}` : ''}${context ? `${escapeHtml(context)}${linesForPart.length ? '\n' : ''}` : ''}${linesForPart.map(escapeHtml).join('\n')}`
    const blocks = [{ type: 'paragraph', text: plainText }]
    const workRefs = [...new Map(factsForPart.map((entry) => entry.workRef).filter(isValidWorkRef).map((ref) => [ref.id, ref])).values()]
    const workOrderBindings = factsForPart.filter((entry) => isValidWorkRef(entry.workRef))
      .flatMap((entry) => (entry.workOrders ?? (entry.workOrder ? [entry.workOrder] : []))
        .map((order) => ({ workRef: { ...entry.workRef }, order })))
    const part = { plaintext: plainText, html, format: 'html', rich_message: { blocks }, demo: demo === true,
      ...(workRefs.length ? { workRefs } : {}), ...(workOrderBindings.length ? { workOrderBindings } : {}) }
    return part
  })
  const event = events[0]
  const actionCandidate = !demo && events.length === 1 ? getNotificationPresentation(event).action : null
  if (actionCandidate) {
    const validAction = validateNotificationAction(actionCandidate, { demo })
    if (validAction) {
      const part = parts[0]
      part.keyboard = { buttons: [{ text: validAction.label, url: validAction.url }] }
      part.actionKind = demo && validAction.url.endsWith('#/ui-kit') ? 'demo' : 'education'
      if (part.actionKind === 'education') part.navigationContext = { kind: 'day', dayToken: event.navigationContext.dayToken }
      part.rich_message.blocks.push({ type: 'buttons', buttons: [{ text: validAction.label, url: validAction.url, style: 'primary' }] })
    }
  }
  return parts
}

export function notificationMessageVersion(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return null
  if (parts.every((part) => typeof part === 'string' && part.length > 0 && [...part].length <= 4096)) return 1
  if (parts.every(isValidNotificationPart)) return 2
  return null
}

export function isValidNotificationPart(part) {
  if (!part || typeof part !== 'object' || Array.isArray(part)
    || !validText(part.plaintext, 3900) || !validText(part.html, 24000) || /<(?!\/?(?:b|i)>)/i.test(part.html)
    || (part.html.match(/<b>/g)?.length ?? 0) !== (part.html.match(/<\/b>/g)?.length ?? 0)
    || (part.html.match(/<i>/g)?.length ?? 0) !== (part.html.match(/<\/i>/g)?.length ?? 0)
    || !part.rich_message || !Array.isArray(part.rich_message.blocks) || !part.rich_message.blocks.length
    || Object.keys(part.rich_message).some((key) => key !== 'blocks')
    || (part.format !== undefined && part.format !== 'html')
    || (part.format === 'html' && (part.rich_message.blocks.filter((block) => block?.type === 'heading' || block?.type === 'divider' || block?.type === 'footer').length > 0
      || part.rich_message.blocks.filter((block) => block?.type === 'paragraph').length !== 1))
    || part.rich_message.blocks.length > 20 || part.rich_message.media !== undefined || typeof part.demo !== 'boolean') return false
  for (const block of part.rich_message.blocks) {
    if (block?.type === 'divider') { if (Object.keys(block).length !== 1) return false; continue }
    if (block?.type === 'heading') {
      if (!Number.isInteger(block.size) || block.size < 1 || block.size > 6 || !validRichText(block.text, 1000) || Object.keys(block).some((key) => !['type', 'size', 'text'].includes(key))) return false
    } else if (['paragraph', 'footer'].includes(block?.type)) {
      if (!validRichText(block.text, 3900) || Object.keys(block).some((key) => !['type', 'text'].includes(key))) return false
    } else if (block?.type === 'buttons') {
      if (block.align !== undefined || !Array.isArray(block.buttons) || block.buttons.length !== 1 || Object.keys(block).some((key) => !['type', 'buttons'].includes(key))) return false
      const button = block.buttons[0]
      if (!button || Object.keys(button).length !== 3 || Object.keys(button).some((key) => !['text', 'url', 'style'].includes(key))
        || !validText(button.text, 60) || button.style !== 'primary'
        || !validateNotificationAction({ label: button.text, url: button.url }, { demo: part.demo && part.actionKind === 'demo' })) return false
    } else return false
  }
  if (part.rich_message.blocks.reduce((total, block) => total + richTextLength(block.text ?? ''), 0) > 3900) return false
  if (part.keyboard !== undefined) {
    if (!validKeyboard(part.keyboard, part.actionKind, part.demo)) return false
  }
  const hasRichButton = part.rich_message.blocks.some((block) => block.type === 'buttons')
  if (hasRichButton !== (part.keyboard !== undefined)) return false
  if (part.keyboard && !['education', 'demo'].includes(part.actionKind)) return false
  if (!part.keyboard && part.actionKind !== undefined) return false
  if (part.actionKind === 'education') {
    const fallbackButton = part.keyboard.buttons[0]
    if (part.demo || !part.navigationContext || part.navigationContext.kind !== 'day'
      || !/^[A-Za-z0-9_-]{1,128}$/.test(part.navigationContext.dayToken ?? '')
      || Object.keys(part.navigationContext).some((key) => !['kind', 'dayToken'].includes(key))
      || fallbackButton.url !== `https://rubaxa.github.io/education-quizzes/#/day/${part.navigationContext.dayToken}`
      || richButton(part)?.url !== fallbackButton.url
      || richButton(part)?.text !== fallbackButton.text) return false
  } else if (part.actionKind === 'demo') {
    const fallbackButton = part.keyboard?.buttons?.[0]
    if (!part.demo || fallbackButton?.url !== 'https://rubaxa.github.io/education-quizzes/#/ui-kit'
      || richButton(part)?.url !== fallbackButton.url || richButton(part)?.text !== fallbackButton.text) return false
  } else if (part.navigationContext !== undefined) return false
  if (part.workRefs !== undefined && (!Array.isArray(part.workRefs) || part.workRefs.some((ref) => !isValidWorkRef(ref)))) return false
  if (part.workOrderBindings !== undefined && (!Array.isArray(part.workOrderBindings) || part.workOrderBindings.some((binding) =>
    !binding || Object.keys(binding).some((key) => !['workRef', 'order'].includes(key)) || !isValidWorkRef(binding.workRef)
      || !isValidWorkOrder({ eventId: typeof binding.order === 'string' ? binding.order.slice(-64) : '', detectedAt: typeof binding.order === 'string' ? binding.order.slice(0, -65) : '' })
      || !part.workRefs?.some((ref) => ref.id === binding.workRef.id)))) return false
  if (part.replyToMessageId !== undefined && (!Number.isSafeInteger(part.replyToMessageId) || part.replyToMessageId <= 0)) return false
  return Object.keys(part).every((key) => ['plaintext', 'html', 'format', 'rich_message', 'keyboard', 'demo', 'actionKind', 'navigationContext', 'workRefs', 'workOrderBindings', 'replyToMessageId'].includes(key))
}
function richButton(part) { return part.rich_message.blocks.find((block) => block.type === 'buttons')?.buttons?.[0] ?? null }

function validKeyboard(value, actionKind, demo) {
  if (!value || Object.keys(value).length !== 1 || !Array.isArray(value.buttons) || value.buttons.length !== 1 || Array.isArray(value.buttons[0])) return false
  const button = value.buttons[0]
  return Object.keys(button ?? {}).every((key) => ['text', 'url'].includes(key)) && validText(button?.text, 60)
    && validateNotificationAction({ label: button?.text, url: button?.url }, { demo: actionKind === 'demo' && demo })?.url === button.url
}
function validRichText(value, max) {
  if (typeof value === 'string') return validText(value, max)
  if (!value || Array.isArray(value) || typeof value !== 'object' || !['bold', 'italic'].includes(value.type)) return false
  return Object.keys(value).length === 2 && Object.keys(value).every((key) => ['type', 'text'].includes(key)) && validText(value.text, max)
}
function richTextLength(value) { return typeof value === 'string' ? [...value].length : [...value.text].length }
// eslint-disable-next-line no-control-regex -- Outbox text must not contain control bytes.
function validText(value, max) { return typeof value === 'string' && value.length > 0 && [...value].length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) }
function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

function safeText(value) {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex -- Strip control bytes before sending untrusted text to Telegram.
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/https?:\/\/\S+/gi, '[ссылка скрыта]')
    .replace(/(?:token|secret|password|ответы|ключ)[=: ]+\S+/gi, '[данные скрыты]').trim()
}

function safeGrade(value) {
  return typeof value === 'string' && /^[1-5](?:[+-])?$/.test(value.trim()) ? value.trim() : ''
}

function splitText(text, maxChars) {
  if (!Number.isInteger(maxChars) || maxChars < 100) throw new Error('invalid_message_limit')
  const chars = [...text]
  if (chars.length <= maxChars) return [text]
  const bodyLimit = maxChars - 40
  const chunks = []
  for (let start = 0; start < chars.length; start += bodyLimit) chunks.push(chars.slice(start, start + bodyLimit).join(''))
  const count = chunks.length
  return chunks.map((chunk, index) => `📚 Education · часть ${index + 1}/${count}\n${chunk}`)
}
