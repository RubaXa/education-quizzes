import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isBuildInput, buildFingerprint } from './build-inputs.mjs'

/** @see ../docs/product/pwa.md */
describe('site build inputs', () => {
  it('invalidates cached builds when shared package or day modules change, excluding their tests', () => {
    const root = mkdtempSync(join(tmpdir(), 'education-build-shared-'))
    try {
      mkdirSync(join(root, 'packages/shared'), { recursive: true })
      mkdirSync(join(root, 'day'), { recursive: true })
      writeFileSync(join(root, 'packages/shared/message.mjs'), 'export const message = 1')
      const initial = buildFingerprint(root)
      writeFileSync(join(root, 'packages/shared/message.mjs'), 'export const message = 2')
      const shared = buildFingerprint(root)
      expect(shared).not.toBe(initial)
      writeFileSync(join(root, 'packages/shared/message.test.mjs'), 'test-only change')
      expect(buildFingerprint(root)).toBe(shared)
      writeFileSync(join(root, 'day/subject-identity.mjs'), 'export const subject = 1')
      expect(buildFingerprint(root)).not.toBe(shared)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('ignores source tests that cannot change the shipped bundle', () => {
    expect(isBuildInput('src/DayDashboard.warmStart.test.tsx')).toBe(false)
    expect(isBuildInput('src/lib/dayStore.spec.ts')).toBe(false)
  })

  it('keeps actual application code and styles', () => {
    expect(isBuildInput('src/DayDashboard.tsx')).toBe(true)
    expect(isBuildInput('src/DayDashboard.css')).toBe(true)
  })
})
