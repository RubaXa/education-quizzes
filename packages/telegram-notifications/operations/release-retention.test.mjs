/** @see ../../../docs/services/telegram-bot/operations.md#release-retention */
import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { withReleaseLock, pruneReleases, readRollback } from './release-retention.mjs'
const roots = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function fixture() {
  const support = mkdtempSync(resolve(tmpdir(), 'retention-')); roots.push(support)
  const hashes = ['a','b','c','d'].map(c => c.repeat(24))
  const paths = hashes.map(hash => resolve(support, 'releases', hash))
  paths.forEach(path => { mkdirSync(resolve(path, 'scripts'), { recursive: true }); writeFileSync(resolve(path, 'scripts/code.mjs'), 'hello') })
  return { support, hashes, paths, options: { support, active: hashes[0], backup: hashes[1], verifyActive: () => true, livePaths: () => new Set([paths[0]]) } }
}
it('keeps active, certified rollback and all live releases; deletes only other trees and journals bytes', () => {
  const f = fixture()
  const run = () => withReleaseLock(f.support, () => pruneReleases({ ...f.options, livePaths: () => new Set([f.paths[0], f.paths[2]]), apply: true }))
  expect(run()).toMatchObject({ removed: [{ hash: f.hashes[3], bytes: 5 }], removedBytes: 5 })
  expect(f.paths.slice(0,3).every(existsSync)).toBe(true)
  expect(run().removed).toEqual([])
  expect(readFileSync(resolve(f.support, 'release-retention.jsonl'), 'utf8')).toContain('deleted')
})
it('dry run never removes files and no backup is inferred from age', () => {
  const f = fixture()
  expect(pruneReleases({ ...f.options, backup: null }).removed).toHaveLength(3)
  expect(f.paths.every(existsSync)).toBe(true)
})
it('fails closed on unknown health, process inventory failure or unsafe root symlink', () => {
  const f = fixture()
  expect(() => pruneReleases({ ...f.options, verifyActive: () => false, apply: true })).toThrow('release_health_unverified')
  expect(() => pruneReleases({ ...f.options, livePaths: () => { throw Error('ps failed') }, apply: true })).toThrow('ps failed')
  rmSync(f.paths[3], { recursive: true }); symlinkSync(f.paths[2], f.paths[3])
  expect(() => pruneReleases({ ...f.options, apply: true })).toThrow('release_unsafe_tree')
  expect(f.paths.slice(0,3).every(existsSync)).toBe(true)
})
it('serializes installer and cleanup; failure releases lock without touching versions', () => {
  const f = fixture()
  expect(() => withReleaseLock(f.support, () => withReleaseLock(f.support, () => {}))).toThrow('release_maintenance_busy')
  expect(() => withReleaseLock(f.support, () => { throw Error('install failed') })).toThrow('install failed')
  expect(withReleaseLock(f.support, () => 'recovered')).toBe('recovered')
  expect(f.paths.every(existsSync)).toBe(true)
})
it('rechecks process races before deletion and stops when active worker dies', () => {
  const f = fixture(); let calls = 0
  expect(pruneReleases({ ...f.options, apply: true, livePaths: () => ++calls === 1 ? new Set() : new Set(f.paths) }).removed).toEqual([])
  let checks = 0
  expect(() => pruneReleases({ ...f.options, apply: true, verifyActive: () => ++checks === 1 })).toThrow('release_health_unverified')
  expect(f.paths.every(existsSync)).toBe(true)
})
it('refuses a release containing user data instead of deleting it', () => {
  const f = fixture(); mkdirSync(resolve(f.paths[3], '.local')); writeFileSync(resolve(f.paths[3], '.local/work.jpg'), 'original')
  expect(() => pruneReleases({ ...f.options, apply: true })).toThrow('release_unsafe_tree')
  expect(f.paths.every(existsSync)).toBe(true)
})
it('never traverses or changes sibling learner data, credentials, logs or uploads', () => {
  const f = fixture()
  const preserved = ['.local/work/original.jpg', 'library/book.pdf', 'events/history.md',
    'secrets/token', 'logs/worker.jsonl', 'upload-worker/original.pdf']
  for (const path of preserved) {
    const target = resolve(f.support, path)
    mkdirSync(resolve(target, '..'), { recursive: true })
    writeFileSync(target, `keep:${path}`)
  }
  pruneReleases({ ...f.options, apply: true })
  expect(f.paths.slice(0, 2).every(existsSync)).toBe(true)
  expect(f.paths.slice(2).some(existsSync)).toBe(false)
  for (const path of preserved) expect(readFileSync(resolve(f.support, path), 'utf8')).toBe(`keep:${path}`)
})
it('refuses corrupt or invalid rollback metadata instead of treating it as no reserve', () => {
  const f = fixture()
  expect(readRollback(f.support)).toBe(null)
  for (const value of ['invalid json', 'null', '{"active":"../secrets","backup":null}']) {
    writeFileSync(resolve(f.support, 'release-rollback.json'), value)
    expect(() => readRollback(f.support)).toThrow('release_backup_unverified')
    expect(f.paths.every(existsSync)).toBe(true)
  }
})
