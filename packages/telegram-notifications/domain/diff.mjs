import { createHash } from 'node:crypto'
import { createDomainEvent, EVENT_TYPES } from './events.mjs'
import { isValidEducationDayToken } from '../../education-presentation/notification.mjs'

/** @see ../../../docs/services/telegram-bot/ports-and-events.md#контракт-observation @see ../../../docs/services/telegram-bot/adapters/mesh.md#контракт-снимка */
export function diffCompleteSnapshots({ source, scopeKey, familyId, childId, previous, current, detectedAt }) {
  if (typeof detectedAt !== 'string' || Number.isNaN(Date.parse(detectedAt))) return { events: [], baseline: previous, advanced: false }
  if (!validSnapshot(current)) return { events: [], baseline: previous, advanced: false }
  if (!previous) return { events: [], baseline: current, advanced: true }
  if (!validSnapshot(previous)) return { events: [], baseline: previous, advanced: false }
  if (current.observationSequence <= previous.observationSequence) return { events: [], baseline: previous, advanced: false }
  const old = new Map(previous.records.map((record) => [record.recordKey, record]))
  const next = new Map(current.records.map((record) => [record.recordKey, record]))
  const events = []
  for (const [recordKey, record] of next) {
    const before = old.get(recordKey)
    if (before && stable(before) === stable(record)) continue
    const eventType = record.eventType ?? (before ? inferChanged(record.kind) : inferCreated(record.kind))
    if (!eventType || !EVENT_TYPE_SET.has(eventType)) return { events: [], baseline: previous, advanced: false }
    const from = before ? stable(before) : 'absent'
    const to = stable(record)
    const revision = createHash('sha256').update(JSON.stringify([current.observationSequence, from, to])).digest('hex')
    events.push(createDomainEvent({
      source, scopeKey, familyId, childId, sourceEventKey: recordKey,
      sourceRevision: revision, eventType, occurredAt: record.occurredAt, detectedAt,
      privacyClass: 'family-summary', fields: record.fields, navigationContext: record.navigationContext,
    }))
  }
  // Deletions are deliberately omitted: disappearance alone is not proof of deletion.
  return { events, baseline: current, advanced: true }
}

const EVENT_TYPE_SET = new Set(EVENT_TYPES)
const fieldKeys = ['childName', 'subject', 'title', 'value', 'status', 'occurredLabel']
function validSnapshot(snapshot) {
  if (!snapshot || snapshot.complete !== true || !Array.isArray(snapshot.records) || !Number.isSafeInteger(snapshot.observationSequence) || snapshot.observationSequence < 0) return false
  const seen = new Set()
  for (const record of snapshot.records) {
    if (!record || typeof record.recordKey !== 'string' || !record.recordKey.trim() || !['grade', 'schedule', 'assignment', 'upload', 'quiz', 'review', 'probe'].includes(record.kind)) return false
    if (record.eventType && !EVENT_TYPE_SET.has(record.eventType)) return false
    if (record.navigationContext !== undefined && (record.kind !== 'upload' || record.navigationContext?.kind !== 'day'
      || !isValidEducationDayToken(record.navigationContext.dayToken)
      || Object.keys(record.navigationContext).some((key) => !['kind', 'dayToken'].includes(key)))) return false
    if (record.semanticHash !== undefined && (typeof record.semanticHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.semanticHash))) return false
    if (record.fields !== undefined && (!record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields))) return false
    if (seen.has(record.recordKey)) return false
    seen.add(record.recordKey)
  }
  return true
}
const stable = (record) => JSON.stringify({
  kind: record.kind,
  eventType: record.eventType ?? null,
  semanticHash: record.semanticHash ?? null,
  occurredAt: canonicalInstant(record.occurredAt),
  fields: canonicalFields(record.fields ?? {}),
  navigationContext: record.navigationContext ?? null,
})
function canonicalInstant(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? `invalid:${String(value)}` : parsed.toISOString()
}
function canonicalFields(fields) {
  return Object.fromEntries(fieldKeys.filter((key) => typeof fields[key] === 'string').sort().map((key) => [key, fields[key]]))
}
const inferCreated = (kind) => ({ grade: 'grade.created', schedule: 'schedule.created', assignment: 'homework.assigned' })[kind]
const inferChanged = (kind) => ({ grade: 'grade.changed', schedule: 'schedule.changed', assignment: 'homework.changed' })[kind]
