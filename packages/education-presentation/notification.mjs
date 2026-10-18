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
  example('review', 'Проверка', 'review.changed', { childName: 'Ученик Б', subject: 'Математика' }, 'needs-fix'),
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
    action: validAction,
    demo: demo === true,
  }
}

export function validateNotificationAction(action, { demo = false } = {}) { return validateAction(action, { demo }) }
export function isValidEducationDayToken(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }

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
  if (type === 'review.changed') return ({ verified: 'complete', 'needs-fix': 'needs-fix', partial: 'partial', 'cannot-assess': 'unknown' })[fields.status] ?? null
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
