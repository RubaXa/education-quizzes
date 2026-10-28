import { describe, expect, it } from 'vitest'
import { calendarScrollTarget } from './dayCalendarScroll'

describe('shared day calendar positioning', () => {
  const viewport = { scrollLeft: 0, viewportLeft: 100, viewportRight: 900, dayWidth: 68 }

  it('centers the selected date on first display', () => {
    expect(calendarScrollTarget({ ...viewport, dayLeft: 500, dayRight: 568, initial: true })).toBe(34)
  })

  it('leaves the strip still while the selected date is away from its edges', () => {
    expect(calendarScrollTarget({ ...viewport, dayLeft: 400, dayRight: 468, initial: false })).toBeNull()
  })

  it('centers a selected date smoothly when it reaches either edge zone', () => {
    expect(calendarScrollTarget({ ...viewport, dayLeft: 120, dayRight: 188, initial: false })).toBe(0)
    expect(calendarScrollTarget({ ...viewport, dayLeft: 820, dayRight: 888, initial: false })).toBe(354)
  })
})
