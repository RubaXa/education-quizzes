import { describe, expect, it } from 'vitest'
import { formatUploadTimestamp } from './uploadTimestamp'

describe('server upload timestamp', () => {
  it('formats Firestore seconds and nanoseconds in Moscow time with a canonical datetime', () => {
    expect(formatUploadTimestamp({ seconds: 1792490580, nanoseconds: 250000000 })).toEqual({
      dateTime: '2026-10-20T10:03:00.250Z', label: '20 октября 2026, 13:03 МСК',
    })
  })
  it('accepts Firestore toDate, Date, and ISO values', () => {
    const date = new Date('2026-10-20T10:03:00.000Z')
    expect(formatUploadTimestamp({ toDate: () => date })?.dateTime).toBe(date.toISOString())
    expect(formatUploadTimestamp(date)?.label).toContain('13:03 МСК')
    expect(formatUploadTimestamp('2026-10-20T10:03:00Z')?.dateTime).toBe(date.toISOString())
  })
  it('rejects ISO dates without an explicit timezone and formats the UTC-to-Moscow day boundary', () => {
    expect(formatUploadTimestamp('2026-10-20')).toBeNull()
    expect(formatUploadTimestamp('2026-10-20T10:03:00')).toBeNull()
    expect(formatUploadTimestamp('2026-02-30T10:03:00Z')).toBeNull()
    expect(formatUploadTimestamp(new Date(Number.NaN))).toBeNull()
    expect(formatUploadTimestamp('2026-10-20T22:30:00Z')?.label).toBe('21 октября 2026, 01:30 МСК')
  })
  it.each([undefined, null, 'bad date', {}, { toDate: () => { throw new Error('bad') } }])('rejects missing or malformed values', (value) => {
    expect(formatUploadTimestamp(value)).toBeNull()
  })
})
