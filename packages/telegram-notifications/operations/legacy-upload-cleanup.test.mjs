/** @see ../../../docs/services/upload-worker/README.md#очистка-старой-установки */
import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { cleanupLegacyUpload } from './legacy-upload-cleanup.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))
function fixture() {
  const home = mkdtempSync(resolve(tmpdir(), 'legacy-upload-test-')); roots.push(home)
  const legacy = resolve(home, 'Library/Application Support/PETR/upload-worker')
  const support = resolve(home, 'Library/Application Support/PETR/telegram-worker')
  const agents = resolve(home, 'Library/LaunchAgents')
  const preserved = { '.local/adc.json': 'private-credential', '.local/yandex-disk-token': 'private-token',
    '.local/work.jpg': 'original-learner-work', '.local/upload-worker.log': 'operational-history',
    'package.json': '{"private":true}', 'package-lock.json': '{}' }
  for (const [path, value] of Object.entries({ ...preserved, 'scripts/direct-upload-worker.mjs': 'export {}',
    'node_modules/dependency/index.js': 'x'.repeat(256 * 1024) })) {
    const target = resolve(legacy, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value)
  }
  mkdirSync(agents, { recursive: true })
  const disabled = resolve(agents, 'com.petr.education.upload-worker.plist.disabled')
  writeFileSync(disabled, 'legacy configuration')
  const active = resolve(support, 'releases', 'a'.repeat(24), 'scripts/code.mjs')
  const backup = resolve(support, 'releases', 'b'.repeat(24), 'scripts/code.mjs')
  for (const path of [active, backup]) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'keep worker') }
  const flags = { process: false, open: false, loaded: false, inventory: true, replacement: true }
  const options = { home, uid: 503, platform: 'darwin', verifyReplacement: () => flags.replacement,
    exec(binary, args, options) {
      if (binary === '/bin/launchctl') {
        if (flags.loaded) return 'loaded'
        throw Object.assign(Error('not loaded'), { status: 113 })
      }
      if (binary === '/bin/ps') {
        if (!flags.inventory) throw Error('inventory unavailable')
        return flags.process ? 'node ' + legacy + '/scripts/direct-upload-worker.mjs' : 'node current-worker'
      }
      if (binary === '/usr/sbin/lsof') {
        if (flags.open) return '123'
        throw Object.assign(Error('no open files'), { status: 1, stderr: '' })
      }
      if (binary === '/usr/bin/plutil') return readFileSync(args.at(-1), 'utf8')
      return execFileSync(binary, args, options)
    } }
  return { home, legacy, support, agents, disabled, active, backup, flags, options, preserved }
}
it('dry-run writes nothing; apply archives keys, work, logs and plist, preserving active and backup', () => {
  const f = fixture()
  const plan = cleanupLegacyUpload(f.options)
  expect(plan).toMatchObject({ applied: false, unused: true, preservedFiles: 7 })
  expect(existsSync(plan.archivePath)).toBe(false)
  expect(existsSync(f.legacy)).toBe(true)
  const result = cleanupLegacyUpload({ ...f.options, apply: true })
  expect(result.freedAllocatedBytes).toBeGreaterThan(0)
  expect(existsSync(f.legacy)).toBe(false)
  expect(existsSync(f.disabled)).toBe(false)
  for (const [path, value] of Object.entries(f.preserved)) {
    expect(readFileSync(resolve(result.archivePath, path), 'utf8')).toBe(value)
    expect(statSync(resolve(result.archivePath, path)).mode & 0o077).toBe(0)
  }
  expect(readFileSync(resolve(result.archivePath, 'launchagents/com.petr.education.upload-worker.plist.disabled'), 'utf8')).toBe('legacy configuration')
  expect([f.active, f.backup].map(path => readFileSync(path, 'utf8'))).toEqual(['keep worker', 'keep worker'])
  expect(JSON.stringify(result)).not.toContain('private-token')
  expect(cleanupLegacyUpload({ ...f.options, apply: true })).toMatchObject({ alreadyRemoved: true, freedAllocatedBytes: 0 })
})
it('refuses live processes, loaded agent, open files, failed inventory or unverified replacement', () => {
  for (const key of ['process', 'loaded', 'open', 'inventory', 'replacement']) {
    const f = fixture(); f.flags[key] = !f.flags[key]
    expect(() => cleanupLegacyUpload({ ...f.options, apply: true })).toThrow()
    expect(existsSync(f.legacy)).toBe(true)
    expect(existsSync(f.disabled)).toBe(true)
  }
})
it('refuses active plist references, including a credential symlink into the legacy tree', () => {
  for (const symlink of [false, true]) {
    const f = fixture(), path = resolve(f.home, 'shared-credential')
    symlinkSync(resolve(f.legacy, '.local/adc.json'), path)
    writeFileSync(resolve(f.agents, 'other.plist'), JSON.stringify({ credential: symlink ? path : f.legacy + '/.local/adc.json' }))
    expect(() => cleanupLegacyUpload({ ...f.options, apply: true })).toThrow('legacy_upload_referenced')
    expect(existsSync(f.legacy)).toBe(true)
  }
})
it('refuses unknown originals outside local data and unsafe symlinks without deleting anything', () => {
  for (const kind of ['unknown', 'symlink']) {
    const f = fixture()
    if (kind === 'unknown') writeFileSync(resolve(f.legacy, 'textbook.pdf'), 'keep original')
    else symlinkSync(f.active, resolve(f.legacy, '.local/linked-original'))
    expect(() => cleanupLegacyUpload({ ...f.options, apply: true })).toThrow('legacy_upload_unsafe_tree')
    expect(existsSync(f.legacy)).toBe(true)
    expect(readFileSync(f.active, 'utf8')).toBe('keep worker')
  }
})
