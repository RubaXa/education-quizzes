/** @see ../../../docs/decisions/olympiad-calendar-2026-10-31.md */
export type OlympiadEvent = { id: string; title: string; at: string; until?: string; provisional?: boolean; sourceUrl: string }
export type OlympiadCalendar = { checkedAt: string; registrationUrl: string; registrationNote: string; registrationLinkLabel?: string; statusLabel?: string; registrationOpensAt?: string; registrationClosesAt?: string; events: OlympiadEvent[]; notes: string[]; preparation: string[]; sources: { title: string; url: string }[] }
const https = (value: unknown): value is string => {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password } catch { return false }
}
const instant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
export const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value
const eventDate = (value: unknown): value is string => typeof value === 'string' && (instant(value) || isDateOnly(value))
const moscowDay = (value: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date(value))
export const olympiadEventExpired = (event: OlympiadEvent, now: number) => isDateOnly(event.until ?? event.at) ? (event.until ?? event.at) < moscowDay(now) : Date.parse(event.until ?? event.at) <= now
export function parseOlympiadCalendar(value: unknown): OlympiadCalendar | undefined {
  if (!value || typeof value !== 'object') return undefined
  const c = value as OlympiadCalendar
  if (!instant(c.checkedAt) || !https(c.registrationUrl) || typeof c.registrationNote !== 'string'
    || (c.registrationOpensAt !== undefined && !instant(c.registrationOpensAt)) || (c.registrationClosesAt !== undefined && !instant(c.registrationClosesAt))
    || (c.statusLabel !== undefined && typeof c.statusLabel !== 'string') || (c.registrationLinkLabel !== undefined && typeof c.registrationLinkLabel !== 'string') || !Array.isArray(c.events) || c.events.some(e => !e || typeof e.id !== 'string' || typeof e.title !== 'string' || !eventDate(e.at) || !https(e.sourceUrl) || (e.until !== undefined && (!eventDate(e.until) || Date.parse(e.until) < Date.parse(e.at))))) return undefined
  if (![c.notes, c.preparation].every(a => Array.isArray(a) && a.every(s => typeof s === 'string')) || !Array.isArray(c.sources) || c.sources.some(s => typeof s.title !== 'string' || !https(s.url))) return undefined
  return { checkedAt: c.checkedAt, registrationUrl: c.registrationUrl, registrationNote: c.registrationNote, ...(c.statusLabel ? { statusLabel: c.statusLabel } : {}), ...(c.registrationLinkLabel ? { registrationLinkLabel: c.registrationLinkLabel } : {}),
    ...(c.registrationOpensAt ? { registrationOpensAt: c.registrationOpensAt } : {}), ...(c.registrationClosesAt ? { registrationClosesAt: c.registrationClosesAt } : {}),
    events: c.events.map(e => ({ id: e.id, title: e.title, at: e.at, sourceUrl: e.sourceUrl, ...(e.until ? { until: e.until } : {}), ...(e.provisional ? { provisional: true } : {}) })),
    notes: c.notes, preparation: c.preparation, sources: c.sources.map(s => ({ title: s.title, url: s.url })) }
}
export function nextOlympiadEvent(calendar: OlympiadCalendar, now: number) {
  return [...calendar.events].filter(e => !olympiadEventExpired(e, now) || (!isDateOnly(e.at) && !e.until && !e.id.includes('deadline') && moscowDay(Date.parse(e.at)) === moscowDay(now))).sort((a,b) => Date.parse(a.at) - Date.parse(b.at))[0]
}
export function olympiadDate(at: string) {
  if (isDateOnly(at)) return new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(at)) + ' · время не опубликовано'
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: at.includes(':59') ? '2-digit' : undefined, timeZone: 'Europe/Moscow' }).format(new Date(at)) + ' МСК'
}
export function remainingTime(at: string, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(at) - now) / 1000))
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60)
  return seconds === 0 ? 'Срок наступил' : days ? `${days} дн. ${hours} ч.` : hours ? `${hours} ч. ${minutes} мин.` : `${minutes} мин. ${seconds % 60} сек.`
}
