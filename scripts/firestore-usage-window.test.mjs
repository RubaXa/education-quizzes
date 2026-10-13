import { describe, expect, it } from 'vitest'
import { usageWindow } from './firestore-usage-window.mjs'

const now = new Date('2026-10-13T00:20:00Z')
describe('Firestore usage comparison windows', () => {
  it('uses minute buckets for equal short windows', () => {
    const before = usageWindow(['--window', '2026-10-12T23:50:00Z', '2026-10-13T00:00:00Z'], now)
    const after = usageWindow(['--window', '2026-10-13T00:00:00Z', '2026-10-13T00:10:00Z'], now)
    expect(before.end.getTime() - before.start.getTime()).toBe(after.end.getTime() - after.start.getTime())
    expect(before.alignmentSeconds).toBe(60)
    expect(after.alignmentSeconds).toBe(60)
  })
  it('preserves the older hourly invocation and rejects future or ambiguous windows', () => {
    expect(usageWindow(['1'], now).alignmentSeconds).toBe(3600)
    expect(usageWindow(['--minutes', '10'], now).alignmentSeconds).toBe(60)
    expect(() => usageWindow(['--window', '2026-10-13T00:00:00', '2026-10-13T00:10:00Z'], now)).toThrow()
    expect(() => usageWindow(['--window', '2026-10-13T00:15:00Z', '2026-10-13T00:30:00Z'], now)).toThrow()
  })
})
