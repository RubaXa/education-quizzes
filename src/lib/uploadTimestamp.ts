/** @see ../../docs/decisions/upload-photo-timestamp-2026-10-21.md */
/** Formats only the server-recorded child upload time. @see ../../docs/modules/school-diary/day-page.md#photo-timestamp */
export type UploadTimestamp = { dateTime: string; label: string }

function validDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  if (typeof value === 'string') {
    const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i.exec(value)
    if (!iso) return null
    const [, year, month, day, hour, minute, second = '0', offset] = iso
    const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
    const invalidOffset = offset.toUpperCase() !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > daysInMonth || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || invalidOffset) return null
    const parsed = new Date(value)
    return Number.isFinite(parsed.getTime()) ? parsed : null
  }
  if (!value || typeof value !== 'object') return null
  const candidate = value as { toDate?: () => unknown; seconds?: unknown; nanoseconds?: unknown; _seconds?: unknown; _nanoseconds?: unknown }
  if (typeof candidate.toDate === 'function') {
    try { return validDate(candidate.toDate()) } catch { return null }
  }
  const seconds = candidate.seconds ?? candidate._seconds
  if (typeof seconds === 'number' && Number.isFinite(seconds)) {
    const nanos = candidate.nanoseconds ?? candidate._nanoseconds ?? 0
    const millis = seconds * 1000 + (typeof nanos === 'number' && Number.isFinite(nanos) ? nanos / 1e6 : 0)
    const parsed = new Date(millis)
    return Number.isFinite(parsed.getTime()) ? parsed : null
  }
  return null
}

export function formatUploadTimestamp(value: unknown): UploadTimestamp | null {
  const date = validDate(value)
  if (!date) return null
  const dateTime = date.toISOString()
  const day = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' }).format(date).replace(' г.', '')
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
  const label = `${day}, ${time} МСК`
  return { dateTime, label }
}
