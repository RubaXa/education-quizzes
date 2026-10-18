import { createHash } from 'node:crypto'
import { isValidEducationDayToken } from '../../education-presentation/notification.mjs'

/** @see ../../../docs/services/telegram-bot/ports-and-events.md#domain-event-contract */
export const EVENT_TYPES = Object.freeze([
  'schedule.created', 'schedule.changed', 'schedule.cancelled',
  'homework.assigned', 'homework.changed', 'homework.cancelled',
  'grade.created', 'grade.changed', 'upload.confirmed',
  'quiz.started', 'quiz.submitted', 'review.changed', 'technical.probe',
])

const allowedTypes = new Set(EVENT_TYPES)
const sha = (value) => createHash('sha256').update(value).digest('hex')

export function stableEventId(input) {
  const { source, scopeKey, sourceEventKey, sourceRevision, eventType } = input
  if (!allowedTypes.has(eventType)) throw new Error('invalid_event_type')
  for (const value of [source, scopeKey, sourceEventKey, sourceRevision]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('invalid_event_identity')
  }
  const isHashed = input.identityEncoding === 'sha256-v1'
  const identities = [scopeKey, sourceEventKey, sourceRevision].map((value) => isHashed && /^[a-f0-9]{64}$/.test(value) ? value : sha(value))
  return sha(JSON.stringify([source, ...identities, eventType]))
}

/** Accepts only the normalized projection; source payloads must never be passed through. */
export function createDomainEvent(input) {
  if (!allowedTypes.has(input?.eventType)) throw new Error('invalid_event_type')
  if (!['mesh', 'firestore'].includes(input.source)) throw new Error('invalid_event_source')
  if (!['family-summary', 'team-summary', 'restricted'].includes(input.privacyClass)) throw new Error('invalid_privacy_class')
  for (const key of ['familyId', 'childId', 'scopeKey', 'sourceEventKey', 'sourceRevision']) {
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error('invalid_event_identity')
  }
  const detectedAt = safeIso(input.detectedAt)
  if (!detectedAt) throw new Error('detected_at_required')
  const eventId = stableEventId(input)
  return Object.freeze({
    schemaVersion: 1,
    eventId,
    source: input.source,
    identityEncoding: 'sha256-v1',
    sourceEventKey: sha256Identity(input.sourceEventKey, input.identityEncoding),
    sourceRevision: sha256Identity(input.sourceRevision, input.identityEncoding),
    eventType: input.eventType,
    familyId: input.familyId,
    childId: input.childId,
    scopeKey: sha256Identity(input.scopeKey, input.identityEncoding),
    occurredAt: safeIso(input.occurredAt),
    detectedAt,
    privacyClass: input.privacyClass,
    fields: safeFields(input.eventType, input.fields),
    contextRefs: Array.isArray(input.contextRefs) ? input.contextRefs.filter((ref) =>
      ref && ['day', 'task', 'grade'].includes(ref.kind) && typeof ref.id === 'string' && ref.id.trim()).map(({ kind, id }) => ({ kind, id: input.identityEncoding === 'sha256-v1' && /^[a-f0-9]{64}$/.test(id) ? id : sha(id) })) : [],
    ...(safeNavigationContext(input.navigationContext, input.source, input.eventType) ? { navigationContext: safeNavigationContext(input.navigationContext, input.source, input.eventType) } : {}),
  })
}

const sha256Identity = (value, encoding) => encoding === 'sha256-v1' && /^[a-f0-9]{64}$/.test(value) ? value : sha(value)

const safeFields = (eventType, fields) => {
  const result = {}
  if (!fields || typeof fields !== 'object') return result
  const allowedByType = {
    'grade.created': ['childName', 'subject', 'value', 'occurredLabel'],
    'grade.changed': ['childName', 'subject', 'value', 'occurredLabel'],
    'schedule.created': ['childName', 'subject', 'title', 'occurredLabel'],
    'schedule.changed': ['childName', 'subject', 'title', 'occurredLabel'],
    'schedule.cancelled': ['childName', 'subject', 'title', 'occurredLabel'],
    'homework.assigned': ['childName', 'subject', 'title', 'occurredLabel'],
    'homework.changed': ['childName', 'subject', 'title', 'occurredLabel'],
    'homework.cancelled': ['childName', 'subject', 'title', 'occurredLabel'],
    'upload.confirmed': ['childName', 'subject', 'title', 'occurredLabel'],
    'review.changed': ['childName', 'subject', 'title', 'occurredLabel', 'status', 'changeKind'],
    'quiz.started': ['childName', 'subject', 'title', 'status'],
    'quiz.submitted': ['childName', 'subject', 'title', 'status'],
    'technical.probe': [],
  }
  for (const key of allowedByType[eventType] ?? []) {
    if (typeof fields[key] === 'string' && fields[key].trim()) result[key] = sanitizeField(fields[key]).slice(0, 500)
  }
  if (eventType === 'review.changed' && !['verified', 'needs-fix', 'partial', 'cannot-assess'].includes(result.status)) delete result.status
  if (eventType === 'review.changed' && result.changeKind !== 'updated') delete result.changeKind
  if (eventType.startsWith('quiz.') && !['started', 'submitted', 'not_started'].includes(result.status)) delete result.status
  if (eventType.startsWith('grade.') && result.value && !/^[1-5](?:[+-])?$/.test(result.value.trim())) delete result.value
  return result
}

function safeNavigationContext(context, source, eventType) {
  if (source !== 'firestore' || eventType !== 'upload.confirmed' || !context || context.kind !== 'day'
    || !isValidEducationDayToken(context.dayToken)) return null
  const result = { kind: 'day', dayToken: context.dayToken }
  return Object.freeze(result)
}

function sanitizeField(value) {
  // eslint-disable-next-line no-control-regex -- Remove control bytes from untrusted display text.
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/https?:\/\/\S+/gi, '[ссылка скрыта]')
    .replace(/\b(?:token|secret|password|answer|key|ответы|ключ)[=: ]+\S+/gi, '[данные скрыты]').trim()
}

function safeIso(value) {
  if (typeof value !== 'string' && !(value instanceof Date)) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString()
}
