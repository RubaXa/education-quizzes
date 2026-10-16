/** @see ../../../docs/services/telegram-bot/delivery.md#структурный-вид */
const LABELS = Object.freeze({
  'schedule.created': 'Добавлено расписание', 'schedule.changed': 'Изменено расписание', 'schedule.cancelled': 'Расписание отменено',
  'homework.assigned': 'Назначено ДЗ', 'homework.changed': 'Изменено ДЗ', 'homework.cancelled': 'ДЗ отменено',
  'grade.created': 'Новая оценка', 'grade.changed': 'Изменена оценка', 'upload.confirmed': 'Файл загружен',
  'quiz.started': 'Тест начат', 'quiz.submitted': 'Тест отправлен', 'review.changed': 'Обновлена проверка',
})

export function renderEvent(event, audience, { maxChars = 3900 } = {}) {
  if (!['family', 'team'].includes(audience)) throw new Error('invalid_audience')
  if (!Object.hasOwn(LABELS, event.eventType) || event.privacyClass === 'restricted') return []
  if (audience === 'family' && event.privacyClass !== 'family-summary') return []
  if (audience === 'team' && event.privacyClass !== 'team-summary') return []
  const fields = event.fields ?? {}
  const lines = audience === 'team'
    ? ['📚 Событие PETR', `• ${LABELS[event.eventType]}`]
    : ['📚 Изменения в PETR', '', safeText(fields.childName) || 'Ученик',
      `• ${LABELS[event.eventType]}${safeText(fields.subject) ? `: ${safeText(fields.subject)}` : ''}`]
  if (audience === 'team') return splitText(lines.join('\n'), maxChars)
  // Never render before/after, raw payload, URLs, identifiers, or arbitrary object values.
  if (['schedule.created', 'schedule.changed', 'schedule.cancelled', 'homework.assigned', 'homework.changed', 'homework.cancelled'].includes(event.eventType) && safeText(fields.title)) lines.push(`  ${safeText(fields.title)}`)
  if (event.eventType.startsWith('grade.') && safeGrade(fields.value)) lines.push(`  Оценка: ${safeGrade(fields.value)}`)
  if (safeText(fields.occurredLabel)) lines.push(`  ${safeText(fields.occurredLabel)}`)
  return splitText(lines.join('\n'), maxChars)
}

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
  return chunks.map((chunk, index) => `📚 PETR · часть ${index + 1}/${count}\n${chunk}`)
}
