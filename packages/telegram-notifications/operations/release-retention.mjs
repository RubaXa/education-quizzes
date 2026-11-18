/** @see ../../../docs/services/telegram-bot/operations.md#release-retention */
/** @see ../../../docs/decisions/worker-release-retention-2026-11-18.md */
import { mkdirSync, readdirSync, lstatSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const hashPattern = /^[a-f0-9]{24}$/
const releaseRoots = new Set(['assessment', 'day', 'diary', 'olympiad', 'operator', 'packages', 'scripts', 'src', 'storage', 'sync', 'node_modules', 'package.json', 'package-lock.json'])
const failure = code => Object.assign(new Error(code), { safeCode: code })

// Conservative lock recovery: a crashed installer requires operator inspection.
// Never steal a lock merely because it is old (npm/preflight may still be running).
export function withReleaseLock(support, work) {
  mkdirSync(support, { recursive: true, mode: 0o700 })
  const lock = resolve(support, 'release-maintenance.lock')
  try { mkdirSync(lock, { mode: 0o700 }) } catch { throw failure('release_maintenance_busy') }
  try {
    writeFileSync(resolve(lock, 'owner.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 })
    return work()
  } finally { rmSync(lock, { recursive: true }) }
}

export function processReleasePaths(releases, exec = execFileSync) {
  const output = exec('/bin/ps', ['-axo', 'command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (typeof output !== 'string' || !output.trim()) throw failure('release_process_inventory_failed')
  return new Set([...output.matchAll(/[a-f0-9]{24}/g)].map(match => resolve(releases, match[0])))
}

function inspectTree(path) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw failure('release_unsafe_tree')
  if (stat.isFile()) return stat.size
  // npm creates symlinks in node_modules/.bin. They are unlinked, never followed.
  return readdirSync(path).reduce((sum, name) => {
    const child = resolve(path, name), info = lstatSync(child)
    return sum + (info.isSymbolicLink() ? 0 : inspectTree(child))
  }, 0)
}

/** Caller holds release-maintenance.lock across installation AND cleanup.
 * No fallback release is inferred from age: only the previously running, now
 * preflight-verified release may be recorded as rollback. */
export function pruneReleases({ support, active, backup = null, verifyActive,
  livePaths = () => processReleasePaths(resolve(support, 'releases')), apply = false }) {
  const releases = resolve(support, 'releases')
  if (!hashPattern.test(active ?? '') || (backup !== null && !hashPattern.test(backup))) throw failure('release_identity_invalid')
  if (lstatSync(releases).isSymbolicLink()) throw failure('release_unsafe_tree')
  const activePath = resolve(releases, active)
  if (lstatSync(activePath).isSymbolicLink() || !verifyActive(activePath)) throw failure('release_health_unverified')
  const keep = new Set([active, ...(backup ? [backup] : [])])
  const live = livePaths()
  const rows = readdirSync(releases).filter(name => hashPattern.test(name)).map(name => {
    const path = resolve(releases, name)
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw failure('release_unsafe_tree')
    if (readdirSync(path).some(name => !releaseRoots.has(name))) throw failure('release_unsafe_tree')
    return { hash: name, bytes: inspectTree(path), path }
  })
  const candidates = rows.filter(row => !keep.has(row.hash) && !live.has(row.path))
  const removed = []
  for (const row of candidates) {
    // Recheck immediately before each deletion; external live releases are retained.
    if (!verifyActive(activePath)) throw failure('release_health_unverified')
    if (livePaths().has(row.path)) continue
    if (apply) {
      // Persist intent before the irreversible step; crash recovery can reconcile it.
      appendFileSync(resolve(support, 'release-retention.jsonl'), JSON.stringify({ at: new Date().toISOString(), action: 'delete-intent', ...row }) + '\n', { mode: 0o600 })
      rmSync(row.path, { recursive: true })
      appendFileSync(resolve(support, 'release-retention.jsonl'), JSON.stringify({ at: new Date().toISOString(), action: 'deleted', ...row }) + '\n', { mode: 0o600 })
    }
    removed.push({ hash: row.hash, bytes: row.bytes })
  }
  return { applied: apply, active, backup, removed, removedBytes: removed.reduce((sum, row) => sum + row.bytes, 0),
    retained: rows.filter(row => !removed.some(item => item.hash === row.hash)).map(({ hash, bytes }) => ({ hash, bytes })) }
}

export function readRollback(support) {
  try {
    const row = JSON.parse(readFileSync(resolve(support, 'release-rollback.json'), 'utf8'))
    if (!hashPattern.test(row?.active ?? '') || (row.backup !== null && !hashPattern.test(row.backup ?? ''))) {
      throw failure('release_backup_unverified')
    }
    return row
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw failure('release_backup_unverified')
  }
}
