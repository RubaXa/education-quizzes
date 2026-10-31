import { describe, expect, it } from 'vitest'
import { parseOlympiadCalendar, nextOlympiadEvent, remainingTime, olympiadDate } from './calendar'
// @ts-expect-error Public season facts are also consumed by the Node publisher.
import { seasonCalendarCatalog } from '../../../olympiad/season-calendar.mjs'
describe('official olympiad times', () => {
  it('keeps the UTC deadline on the correct Moscow date and never expires it at local midnight', () => {
    const c = parseOlympiadCalendar(seasonCalendarCatalog()[0].calendar)!
    expect(olympiadDate(c.events[0].at)).toContain('6 ноября')
    expect(nextOlympiadEvent(c, Date.parse('2026-11-06T02:00:00+03:00'))).toBeDefined()
    expect(nextOlympiadEvent(c, Date.parse('2026-11-06T03:00:00+03:00'))).toBeUndefined()
  })
  it('shows the end of an active window and leaves the next stream independent', () => {
    const items = seasonCalendarCatalog()
    expect(nextOlympiadEvent(items[1].calendar, Date.parse('2026-11-14T00:00:00Z'))?.until).toBe('2026-11-20T12:00:00+03:00')
    expect(nextOlympiadEvent(items[2].calendar, Date.parse('2026-11-23T00:00:00Z'))?.id).toBe('qualifier-2')
    expect(items[2].calendar.registrationOpensAt).toBeUndefined()
  })
  it('rejects invalid dates, credential URLs and reversed windows', () => {
    const c = seasonCalendarCatalog()[1].calendar
    expect(parseOlympiadCalendar({ ...c, registrationUrl: 'https://key:secret@example.com/' })).toBeUndefined()
    expect(parseOlympiadCalendar({ ...c, events: [{ ...c.events[0], until: '2026-11-01T00:00:00Z' }] })).toBeUndefined()
  })
  it('updates a human countdown without rounding the deadline up a day', () => {
    expect(remainingTime('2026-11-01T00:00:00Z', Date.parse('2026-10-31T23:59:59Z'))).toBe('0 мин. 1 сек.')
  })
})

it('keeps an undated season visible and distinguishes a known day from a known time', () => {
  const base = seasonCalendarCatalog()[0].calendar
  const waiting = parseOlympiadCalendar({ ...base, events: [], statusLabel: 'Даты ещё не опубликованы' })
  expect(waiting).toBeDefined()
  const dateOnly = parseOlympiadCalendar({ ...base, events: [{ id:'final', title:'Финал', at:'2027-02-21', sourceUrl:'https://example.org/' }] })!
  expect(dateOnly).toBeDefined()
  expect(olympiadDate('2027-02-21')).not.toContain('00:00')
  expect(nextOlympiadEvent(dateOnly, Date.parse('2027-02-21T20:00:00+03:00'))).toBeDefined()
  expect(parseOlympiadCalendar({ ...base, events: [{ id:'bad',title:'bad',at:'2027-02-30',sourceUrl:'https://example.org/' }] })).toBeUndefined()
})

it('accepts all published grade-six cards including those awaiting dates', () => {
 const items = seasonCalendarCatalog()
 expect(items).toHaveLength(19)
 expect(new Set(items.map((item: {id:string}) => item.id)).size).toBe(19)
 for (const item of items) {
   expect(item.gradeLevels).toContain(6)
   expect(parseOlympiadCalendar(item.calendar), item.id).toBeDefined()
   expect(item.calendar.preparation.length, item.id).toBeGreaterThan(0)
   expect(item.calendar.registrationNote.length, item.id).toBeGreaterThan(0)
 }
})
