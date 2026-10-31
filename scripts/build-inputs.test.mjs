import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
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

/** A bare bundle can clear dist after a previous full build without changing sources. */
it('restores the PWA service worker after a bare bundle replaced a cached full build', () => {
  const root = mkdtempSync(join(tmpdir(), 'education-build-worker-'))
  try {
    for (const directory of ['dist/assets', '.local', 'scripts', 'pwa']) mkdirSync(join(root, directory), { recursive: true })
    writeFileSync(join(root, 'dist/index.html'), '<html>compiled application</html>')
    copyFileSync(resolve('scripts/generate-sw.mjs'), join(root, 'scripts/generate-sw.mjs'))
    copyFileSync(resolve('pwa/sw-template.js'), join(root, 'pwa/sw-template.js'))
    const fingerprint = buildFingerprint(root)
    writeFileSync(join(root, '.local/dist-build-inputs.sha256'), fingerprint)
    execFileSync(process.execPath, [resolve('scripts/build-site.mjs')], { cwd: root })
    expect(readFileSync(join(root, 'dist/sw.js'), 'utf8')).toContain(`education-shell-${fingerprint.slice(0,16)}`)
    expect(readFileSync(join(root, 'dist/index.html'), 'utf8')).toContain('compiled application')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
