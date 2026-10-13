import { describe, expect, it } from 'vitest'
import { isBuildInput } from './build-inputs.mjs'

/** @see ../docs/product/pwa.md */
describe('site build inputs', () => {
  it('ignores source tests that cannot change the shipped bundle', () => {
    expect(isBuildInput('src/DayDashboard.warmStart.test.tsx')).toBe(false)
    expect(isBuildInput('src/lib/dayStore.spec.ts')).toBe(false)
  })

  it('keeps actual application code and styles', () => {
    expect(isBuildInput('src/DayDashboard.tsx')).toBe(true)
    expect(isBuildInput('src/DayDashboard.css')).toBe(true)
  })
})
