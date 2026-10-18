/* @see ../../docs/decisions/telegram-compact-digest-2026-10-18.md */
/** @see ../../docs/shared/design/telegram.md#визуальная-система @see ../../docs/shared/design/statuses.md#matrix */
export const STATUS_PRESENTATION = Object.freeze({
  ready: status('ready', 'Не начато', 'neutral', 'Circle'),
  started: status('started', 'В процессе', 'accent', 'CircleDot'),
  uploading: status('uploading', 'Передаём фото', 'waiting', 'CloudUpload'),
  waiting: status('waiting', 'Ждёт проверки', 'waiting', 'Clock3'),
  processing: status('processing', 'Проверяем', 'waiting', 'LoaderCircle'),
  paused: status('paused', 'Проверка задержана', 'attention', 'CirclePause'),
  complete: status('complete', 'Проверено', 'success', 'CircleCheck'),
  partial: status('partial', 'Часть подтверждена', 'attention', 'CircleMinus'),
  'needs-fix': status('needs-fix', 'Нужна правка', 'attention', 'CircleAlert'),
  incorrect: status('incorrect', 'Неверно', 'error', 'CircleX'),
  unknown: status('unknown', 'Неясно', 'neutral', 'CircleHelp'),
  failed: status('failed', 'Техническая ошибка', 'error', 'TriangleAlert'),
  new: status('new', 'Новое', 'accent', 'BellDot'),
})

export const NOTIFICATION_EXAMPLES = Object.freeze([
  example('upload', 'Фото получено', 'upload.confirmed', { childName: 'Ученик А', subject: 'Математика', title: 'Упражнение № 2', occurredLabel: 'Задание к 2026-10-22' }, 'waiting'),
  example('grade', 'Оценка', 'grade.created', { childName: 'Ученик Б', subject: 'Русский язык', value: '5', occurredLabel: 'Сегодня' }, 'complete'),
  example('homework', 'Домашнее задание', 'homework.assigned', { childName: 'Ученик А', subject: 'Математика', title: 'Страница 18' }, 'new'),
  example('review', 'Проверка', 'review.changed', { childName: 'Ученик Б', subject: 'Математика', title: 'Упражнение № 3' }, 'needs-fix'),
  example('quiz', 'Тест отправлен', 'quiz.submitted', { childName: 'Ученик А', subject: 'Окружающий мир' }, 'waiting'),
  example('schedule', 'Расписание', 'schedule.changed', { childName: 'Ученик Б', subject: 'Музыка', title: 'Урок перенесён' }, null),
  example('technical', 'Демонстрация', 'technical.probe', {}, null),
])

const LABELS = Object.freeze({
  'upload.confirmed': 'Фото получено', 'grade.created': 'Новая оценка', 'grade.changed': 'Изменена оценка',
  'homework.assigned': 'Новое домашнее задание', 'homework.changed': 'Изменено домашнее задание',
  'homework.cancelled': 'Домашнее задание отменено', 'review.changed': 'Проверка работы',
  'quiz.started': 'Тест начат', 'quiz.submitted': 'Тест отправлен',
  'schedule.created': 'Добавлено расписание', 'schedule.changed': 'Изменено расписание',
  'schedule.cancelled': 'Расписание отменено', 'technical.probe': 'Демонстрация уведомления',
})
const EVENT_STATUS = Object.freeze({ 'upload.confirmed': 'waiting', 'quiz.started': 'started', 'quiz.submitted': 'waiting', 'homework.assigned': 'new' })

export function getNotificationPresentation(event, { demo = false, action = null } = {}) {
  const eventType = safeString(event?.eventType, 80)
  const fields = event?.fields && typeof event.fields === 'object' ? event.fields : {}
  const statusId = statusFor(eventType, fields)
  const occurredLabel = formatOccurred(safeString(fields.occurredLabel, 100))
  const validAction = demo
    ? validateAction(action, { demo })
    : action === null ? actionFromEvent(event) : null
  return {
    eventType,
    headline: `${demo === true ? 'Пример · ' : ''}${LABELS[eventType] ?? 'Изменение в Education'}`,
    eventIcon: ({ 'upload.confirmed': 'Camera', 'grade.created': 'Award', 'grade.changed': 'Award', 'homework.assigned': 'FileText', 'homework.changed': 'FileText', 'homework.cancelled': 'FileText', 'review.changed': 'Search', 'quiz.started': 'FlaskConical', 'quiz.submitted': 'FlaskConical', 'schedule.created': 'Calendar', 'schedule.changed': 'Calendar', 'schedule.cancelled': 'Calendar', 'technical.probe': 'FlaskConical' })[eventType] ?? 'Bell',
    eventEmoji: ({ 'upload.confirmed': '📷', 'grade.created': '🏅', 'grade.changed': '🏅', 'homework.assigned': '📝', 'homework.changed': '📝', 'homework.cancelled': '📝', 'review.changed': '🔎', 'quiz.started': '🧪', 'quiz.submitted': '🧪', 'schedule.created': '🗓', 'schedule.changed': '🗓', 'schedule.cancelled': '🗓', 'technical.probe': '🧪' })[eventType] ?? '📚',
    childName: safeString(fields.childName, 160) || null,
    subject: safeString(fields.subject, 160) || null,
    title: safeString(fields.title, 300) || null,
    occurredLabel: occurredLabel || null,
    status: statusId ? STATUS_PRESENTATION[statusId] : null,
    value: eventType.startsWith('grade.') && /^[1-5][+-]?$/.test(safeString(fields.value, 3)) ? fields.value : null,
    reviewChangeKind: eventType === 'review.changed' && fields.changeKind === 'updated' ? 'updated' : null,
    action: validAction,
    demo: demo === true,
  }
}

/** Stable, compact model shared by Telegram digest delivery and the preview. */
export function getNotificationDigestPresentation(events) {
  if (!Array.isArray(events) || events.length === 0) return null
  const uniqueEvents = []
  const seenEventIds = new Set()
  for (const event of events) {
    if (isValidWorkOrder(event)) {
      if (seenEventIds.has(event.eventId)) continue
      seenEventIds.add(event.eventId)
    }
    uniqueEvents.push(event)
  }
  const models = uniqueEvents.map((event) => getNotificationPresentation(event))
  const valid = models.map((item, index) => ({ item, event: uniqueEvents[index] })).filter(({ item, event }) =>
    event?.eventType !== 'review.changed' || (item.subject && item.title && item.status))
  if (!valid.length) return null
  const childNames = [...new Set(valid.map(({ item }) => item.childName))]
  const subjects = [...new Set(valid.map(({ item }) => item.subject))]
  const childName = childNames.length === 1 && childNames[0] ? childNames[0] : null
  const subject = subjects.length === 1 && subjects[0] ? subjects[0] : null
  const entries = valid.map(({ item, event }) => {
    const fields = event?.fields && typeof event.fields === 'object' ? event.fields : {}
    const previousStatus = statusFor('review.changed', { status: fields.previousStatus })
    return ({
    eventType: item.eventType,
    childName: item.childName,
    subject: item.subject,
    eventEmoji: item.eventEmoji,
    headline: item.headline,
    title: item.title,
    value: item.value,
    occurredLabel: item.occurredLabel,
    reviewChangeKind: item.reviewChangeKind,
    status: item.status ? { id: item.status.id, label: item.status.label, emoji: item.status.emoji } : null,
    previousStatus: previousStatus ? { id: previousStatus, label: STATUS_PRESENTATION[previousStatus].label, emoji: STATUS_PRESENTATION[previousStatus].emoji } : null,
    previousValue: validGrade(fields.previousValue) || null,
    previousTitle: safeString(fields.previousTitle, 300) || null,
    detail: safeString(fields.nextStep, 180) || safeString(fields.summary, 180) || null,
    workRef: isValidWorkRef(event?.workRef) ? { ...event.workRef } : null,
    workOrder: isValidWorkOrder(event) ? `${new Date(event.detectedAt).toISOString()}:${event.eventId}` : null,
    workOrders: isValidWorkOrder(event) ? [`${new Date(event.detectedAt).toISOString()}:${event.eventId}`] : [],
    uploadCount: 1,
  })
  })
  const groupedUploads = new Map()
  const rowsWithUploadGroups = []
  for (const entry of entries) {
    if (entry.eventType !== 'upload.confirmed' || !entry.workRef || !entry.workOrder) {
      rowsWithUploadGroups.push(entry)
      continue
    }
    const key = entry.workRef.id
    const group = groupedUploads.get(key)
    if (group) {
      group.uploadCount += 1
      group.workOrders.push(...entry.workOrders)
    } else {
      groupedUploads.set(key, entry)
      rowsWithUploadGroups.push(entry)
    }
  }
  entries.splice(0, entries.length, ...rowsWithUploadGroups)
  const dueLabels = [...new Set(entries.map((entry) => entry.occurredLabel).filter(Boolean))]
  const dueContext = entries.every((entry) => entry.occurredLabel) && dueLabels.length === 1 ? dueLabels[0] : null
  const changeCount = valid.length
  const header = [childName, `${changeCount} ${pluralChanges(changeCount)}`].filter(Boolean).join(' · ')
  const context = [subject, dueContext].filter(Boolean).join(' · ')
  const rows = entries.map((entry) => {
    const identity = [entry.childName && childName === null ? entry.childName : null,
      entry.subject && subject === null ? entry.subject : null].filter(Boolean).join(' · ')
    if (entry.eventType === 'review.changed') {
      const status = entry.status.label.toLocaleLowerCase('ru-RU')
      const previousLabel = entry.previousStatus?.id === 'waiting' ? 'Ожидало проверки' : entry.previousStatus?.label
      const result = entry.previousStatus ? `${previousLabel} → ${status}` : entry.reviewChangeKind === 'updated' ? `разбор обновлён · ${status}` : status
      return `${entry.status.emoji} ${[identity, entry.title ?? entry.previousTitle].filter(Boolean).join(' · ')} — ${result}${entry.detail ? `\n${entry.detail}` : ''}`
    }
    if (entry.eventType === 'upload.confirmed') return `📷 ${[identity, entry.title].filter(Boolean).join(' · ') || 'Фото работы'} — получено ${entry.uploadCount} ${pluralFiles(entry.uploadCount)} · ждут проверки`
    if (entry.eventType.startsWith('grade.')) {
      const context = [identity, entry.title].filter(Boolean).join(' · ')
      const result = entry.value ? (entry.eventType === 'grade.changed'
        ? `Оценка изменена: ${entry.previousValue ? `${entry.previousValue} → ` : ''}${entry.value}`
        : `Новая оценка ${entry.value}`) : entry.headline
      return `📝 ${context ? `${context} — ` : ''}${result}`
    }
    if (entry.eventType.startsWith('homework.')) {
      const title = entry.title || entry.previousTitle
      if (entry.eventType === 'homework.changed' && entry.previousTitle && entry.title && entry.previousTitle !== entry.title) {
        return `📅 ${identity ? `${identity} — ` : ''}ДЗ изменено\nБыло: ${entry.previousTitle}\nСтало: ${entry.title}`
      }
      return `📅 ${[identity, entry.headline, title].filter(Boolean).join(' · ')}`
    }
    const icon = entry.eventType.startsWith('homework.') ? '📅' : (entry.status?.emoji ?? entry.eventEmoji)
    return `${icon} ${[identity, entry.headline, entry.title].filter(Boolean).join(' · ')}`
  })
  const displayRows = rows.map((row, index) => !dueContext && entries[index].occurredLabel ? `${row} · ${entries[index].occurredLabel}` : row)
  entries.forEach((entry, index) => { entry.text = displayRows[index] })
  const text = [header, context, ...displayRows].filter(Boolean).join('\n')
  return { childName, subject, dueContext, changeCount, header, context, entries, text }
}

export function validateNotificationAction(action, { demo = false } = {}) { return validateAction(action, { demo }) }
export function isValidEducationDayToken(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }
export function isValidWorkRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) && Object.keys(value).length === 2
    && Object.hasOwn(value, 'kind') && value.kind === 'day-task'
    && Object.hasOwn(value, 'id') && typeof value.id === 'string' && /^[a-f0-9]{64}$/.test(value.id)
}
export function isValidWorkOrder(event) { return Boolean(event && typeof event.eventId === 'string' && /^[a-f0-9]{64}$/.test(event.eventId) && typeof event.detectedAt === 'string' && !Number.isNaN(Date.parse(event.detectedAt))) }

function status(id, label, tone, icon) {
  const emoji = { neutral: '⚪', accent: '🟣', waiting: '🔵', success: '🟢', attention: '🟠', error: '🔴' }[tone]
  return Object.freeze({ id, label, tone, emoji, icon })
}
function example(id, label, eventType, fields, statusId) {
  return Object.freeze({ id, label, event: Object.freeze({ eventType, familyId: 'demo-family', childId: `demo-${id}`, privacyClass: 'family-summary', fields: Object.freeze({ ...fields, ...(statusId ? { status: statusId } : {}) }), demo: true }) })
}
function safeString(value, max) {
  // eslint-disable-next-line no-control-regex -- Strip control bytes from display fields.
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/https?:\/\/\S+/gi, '[ссылка скрыта]')
    .replace(/(?:token|secret|password|ответы|ключ)[=: ]+\S+/gi, '[данные скрыты]').trim().slice(0, max) : ''
}
function statusFor(type, fields) {
  if (type === 'review.changed') return ({ waiting: 'waiting', processing: 'processing', verified: 'complete', 'needs-fix': 'needs-fix', partial: 'partial', 'cannot-assess': 'unknown' })[fields.status] ?? null
  return EVENT_STATUS[type] ?? null
}
function formatOccurred(label) {
  const match = /^Задание к (\d{4})-(\d{2})-(\d{2})$/.exec(label)
  if (!match) return label
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2]) || date.getUTCDate() !== Number(match[3])) return label
  const month = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][date.getUTCMonth()]
  return `К ${['воскресенью', 'понедельнику', 'вторнику', 'среде', 'четвергу', 'пятнице', 'субботе'][date.getUTCDay()]}, ${date.getUTCDate()} ${month}`
}
function validGrade(value) { return typeof value === 'string' && /^[1-5](?:[+-])?$/.test(value.trim()) ? value.trim() : '' }
function pluralChanges(count) {
  const lastTwo = count % 100
  if (lastTwo >= 11 && lastTwo <= 14) return 'изменений'
  const last = count % 10
  return last === 1 ? 'изменение' : last >= 2 && last <= 4 ? 'изменения' : 'изменений'
}
function pluralFiles(count) {
  const lastTwo = count % 100
  const last = count % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'файлов'
  return last === 1 ? 'файл' : last >= 2 && last <= 4 ? 'файла' : 'файлов'
}
function validateAction(action, { demo = false } = {}) {
  if (!action || typeof action.label !== 'string' || typeof action.url !== 'string') return null
  try {
    const url = new URL(action.url)
    if (url.protocol !== 'https:' || url.hostname !== 'rubaxa.github.io' || url.pathname !== '/education-quizzes/'
      || url.username || url.password || url.port || url.search
      || (demo ? url.hash !== '#/ui-kit' : !/^#\/day\/[A-Za-z0-9_-]{1,128}$/.test(url.hash))) return null
    return { label: safeString(action.label, 60) || 'Открыть день', url: url.href }
  } catch { return null }
}
function actionFromEvent(event) {
  const context = event?.navigationContext
  if (event?.source !== 'firestore' || event?.eventType !== 'upload.confirmed' || !context || context.kind !== 'day' || !isValidEducationDayToken(context.dayToken)) return null
  return validateAction({ label: 'Открыть день', url: `https://rubaxa.github.io/education-quizzes/#/day/${context.dayToken}` })
}
