import type { InboxNotification } from './educationSchema'

type Item = InboxNotification & { id: string }
const key = (personId: string) => `education-inbox-v1:${personId}`

/** Last seen inbox is part of the first local frame, scoped to one person.
 * Firestore remains authoritative when the current inbox arrives.
 * @see ../../docs/product/dashboard.md#dashboard-warm-start */
export function readCachedInbox(personId: string): Item[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(personId)) ?? 'null')
    if (!value || typeof value !== 'object') return []
    const data = value as { version?: unknown; items?: unknown }
    if (data.version !== 1 || !Array.isArray(data.items) || data.items.length > 100) return []
    return data.items.every((item): item is Item => item && typeof item.id === 'string' &&
      typeof item.familyId === 'string' && typeof item.childId === 'string' && typeof item.type === 'string' &&
      typeof item.sourceRevision === 'number') ? data.items : []
  } catch { return [] }
}
function dateValue(value: unknown): string | undefined {
  const millis = value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function'
    ? value.toMillis() : Date.parse(String(value ?? ''))
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined
}
export function writeCachedInbox(personId: string, items: Item[]): Item[] {
  const previous = new Map(readCachedInbox(personId).map((item) => [item.id, item]))
  // Read receipts only move forward; a stale SDK cache event cannot resurrect
  // a notice already read on this device.
  const merged = items.slice(0, 100).map((item) => ({ ...item,
    createdAt: dateValue(item.createdAt) ?? previous.get(item.id)?.createdAt ?? '',
    readAt: dateValue(item.readAt) ?? previous.get(item.id)?.readAt }))
  try { localStorage.setItem(key(personId), JSON.stringify({ version: 1, items: merged })) }
  catch { /* The live inbox remains available. */ }
  return merged
}
export function markCachedInboxRead(personId: string, ids: string[]) {
  const selected = new Set(ids)
  const at = new Date().toISOString()
  const items = readCachedInbox(personId).map((item) => selected.has(item.id) ? { ...item, readAt: at } : item)
  try { localStorage.setItem(key(personId), JSON.stringify({ version: 1, items })) }
  catch { /* Server receipt still applies. */ }
}
export function clearCachedInbox(personId: string) {
  try { localStorage.removeItem(key(personId)) } catch { /* Ignore unavailable storage. */ }
}
