/** @see ../../../docs/services/upload-worker/README.md#очистка-старой-установки */
/** @see ../../../docs/decisions/legacy-upload-cleanup-2026-11-18.md */
import { existsSync, lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync, chmodSync, rmSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, relative } from 'node:path'
import { withReleaseLock } from './release-retention.mjs'

const fail = code => Object.assign(new Error(code), { safeCode: code })
const label = 'com.petr.education.upload-worker'
const codeFiles = new Set(['scripts/direct-upload-worker.mjs', 'storage/direct-upload.mjs',
  'storage/family-book-projection.mjs', 'storage/family-book-upload.mjs', 'storage/textbook-catalog.mjs',
  'storage/yandex-disk.mjs', 'storage/submission-storage.mjs'])
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (path, root) => path === root || path.startsWith(root + '/')

/** Explicit retirement only; no global storage scan, Firestore write or credential deletion. */
export function cleanupLegacyUpload({ home, uid, platform = process.platform, apply = false,
  exec = execFileSync, verifyReplacement = () => false }) {
  if (platform !== 'darwin' || !Number.isInteger(uid)) throw fail('launchagent_macos_required')
  const legacy = resolve(home, 'Library/Application Support/PETR/upload-worker')
  const support = resolve(home, 'Library/Application Support/PETR/telegram-worker')
  const agents = resolve(home, 'Library/LaunchAgents')
  const size = path => {
    if (!existsSync(path)) return 0
    const output = String(exec('/usr/bin/du', ['-sk', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
    const value = output.match(/^(\d+)\s/)
    if (!value) throw fail('legacy_upload_inventory_failed')
    return Number(value[1]) * 1024
  }
  const disabled = () => readdirSync(agents).filter(name => name === `${label}.plist.disabled`
    || name.startsWith(`${label}.plist.disabled.`)).map(name => resolve(agents, name)).sort()
  const strings = value => typeof value === 'string' ? [value] : value && typeof value === 'object'
    ? Object.values(value).flatMap(strings) : []
  const assertUnused = () => {
    if (!verifyReplacement()) throw fail('legacy_upload_replacement_unverified')
    try {
      exec('/bin/launchctl', ['print', `gui/${uid}/${label}`], { stdio: 'pipe' })
      throw fail('legacy_upload_in_use')
    } catch (error) {
      if (error.safeCode || error.status !== 113) throw error.safeCode ? error : fail('legacy_upload_inventory_failed')
    }
    const processes = String(exec('/bin/ps', ['-axo', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
    if (!processes.trim()) throw fail('legacy_upload_inventory_failed')
    if (processes.includes(legacy) || processes.includes(realpathSync(legacy))) throw fail('legacy_upload_in_use')
    try {
      const open = String(exec('/usr/sbin/lsof', ['-t', '+D', legacy], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
      if (open.trim()) throw fail('legacy_upload_in_use')
    } catch (error) {
      if (error.safeCode || error.status !== 1 || String(error.stderr ?? '').trim()) {
        throw error.safeCode ? error : fail('legacy_upload_inventory_failed')
      }
    }
    for (const name of readdirSync(agents).filter(name => name.endsWith('.plist'))) {
      let config
      try {
        config = JSON.parse(exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', resolve(agents, name)],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
      } catch { throw fail('legacy_upload_inventory_failed') }
      for (const value of strings(config)) {
        if (value.includes(legacy)) throw fail('legacy_upload_referenced')
        if (value.startsWith('/') && existsSync(value) && inside(realpathSync(value), realpathSync(legacy))) throw fail('legacy_upload_referenced')
      }
    }
  }
  const walk = path => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw fail('legacy_upload_unsafe_tree')
    return stat.isDirectory() ? readdirSync(path).sort().flatMap(name => walk(resolve(path, name))) : [path]
  }
  const capture = () => {
    if (lstatSync(legacy).isSymbolicLink()) throw fail('legacy_upload_unsafe_tree')
    const entries = []
    for (const name of readdirSync(legacy)) {
      const path = resolve(legacy, name)
      if (name === 'node_modules') {
        if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) throw fail('legacy_upload_unsafe_tree')
        continue
      }
      if (!['.local', 'package.json', 'package-lock.json', 'scripts', 'storage'].includes(name)) throw fail('legacy_upload_unsafe_tree')
      for (const file of walk(path)) {
        const rel = relative(legacy, file)
        if (name === 'scripts' || name === 'storage') {
          if (!codeFiles.has(rel)) throw fail('legacy_upload_unsafe_tree')
        } else entries.push({ path: rel, bytes: readFileSync(file) })
      }
    }
    for (const file of disabled()) {
      if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw fail('legacy_upload_unsafe_tree')
      entries.push({ path: 'launchagents/' + relative(agents, file), bytes: readFileSync(file) })
    }
    return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  }
  const work = () => {
    if (!existsSync(legacy)) return { applied: false, alreadyRemoved: true, freedAllocatedBytes: 0 }
    assertUnused()
    const entries = capture()
    const inventory = entries.map(({ path, bytes }) => ({ path, sha256: hash(bytes), size: bytes.length }))
    const digest = hash(JSON.stringify(inventory))
    const archiveParent = resolve(support, 'retired-upload-worker')
    const archive = resolve(archiveParent, digest.slice(0, 24))
    for (const path of [support, archiveParent, archive]) {
      if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())) throw fail('legacy_upload_unsafe_tree')
    }
    const disabledFiles = disabled()
    const before = size(legacy) + disabledFiles.reduce((sum, file) => sum + size(file), 0)
    const archiveBefore = size(archive)
    if (!apply) return { applied: false, unused: true, archivePath: archive,
      removableAllocatedBytes: before, preservedFiles: inventory.length }
    mkdirSync(archive, { recursive: true, mode: 0o700 })
    for (const { path, bytes } of entries) {
      const target = resolve(archive, path)
      for (let parent = dirname(target); inside(parent, archive); parent = dirname(parent)) {
        if (existsSync(parent) && (lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory())) throw fail('legacy_upload_unsafe_tree')
      }
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      if (existsSync(target)) {
        if (lstatSync(target).isSymbolicLink() || hash(readFileSync(target)) !== hash(bytes)) throw fail('legacy_upload_archive_mismatch')
      } else writeFileSync(target, bytes, { mode: 0o600, flag: 'wx' })
      chmodSync(target, 0o600)
      if (hash(readFileSync(target)) !== hash(bytes)) throw fail('legacy_upload_archive_mismatch')
    }
    const manifest = resolve(archive, 'manifest.json')
    if (existsSync(manifest) && lstatSync(manifest).isSymbolicLink()) throw fail('legacy_upload_unsafe_tree')
    writeFileSync(manifest, JSON.stringify({ sourcePath: legacy, files: inventory, state: 'archived' }, null, 2) + '\n', { mode: 0o600 })
    chmodSync(manifest, 0o600)
    assertUnused()
    const latest = capture().map(({ path, bytes }) => ({ path, sha256: hash(bytes), size: bytes.length }))
    if (JSON.stringify(latest) !== JSON.stringify(inventory)) throw fail('legacy_upload_changed')
    rmSync(legacy, { recursive: true })
    for (const file of disabledFiles) rmSync(file)
    const archiveBytes = size(archive) - archiveBefore
    const result = { applied: true, unused: true, archivePath: archive, preservedFiles: inventory.length,
      removedAllocatedBytes: before, archiveAddedAllocatedBytes: archiveBytes, freedAllocatedBytes: before - archiveBytes }
    writeFileSync(manifest, JSON.stringify({ sourcePath: legacy, files: inventory, state: 'removed', ...result }, null, 2) + '\n', { mode: 0o600 })
    return result
  }
  return apply ? withReleaseLock(support, work) : work()
}
