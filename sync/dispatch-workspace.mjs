/** @see ../docs/decisions/sync-single-drainer-2026-11-05.md */
/** Private projections of the server lease; never a second queue or source of authority.
 * @see ../docs/services/telegram-bot/education-sync-dispatch.md#single-drainer */
import { mkdirSync, writeFileSync, renameSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export const WORK_PHASES = ['claimed', 'inventory', 'inbox', 'mesh', 'sources', 'review', 'publication', 'verifying', 'waiting', 'completed', 'failed', 'blocked']
export function writeDispatchProgress(root, requestId, patch) {
  if (!/^[a-f0-9-]{36}$/.test(requestId) || !WORK_PHASES.includes(patch.phase)) throw new Error('dispatch_progress_invalid')
  const path = resolve(root, '.local/education-sync-dispatch/work', requestId, 'progress.json')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  const allowed = Object.fromEntries(['phase', 'generation', 'manifestPath', 'completedGeneration'].filter(k => patch[k] !== undefined).map(k => [k, patch[k]]))
  const value = { ...previous, ...allowed, requestId, updatedAt: new Date().toISOString() }
  const temporary = `${path}.${randomUUID()}.tmp`
  try { writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temporary, path) }
  finally { rmSync(temporary, { force: true }) }
  return path
}

// Only call after the server acknowledges the exact batch. Sources/uploads remain in their own stores.
export function clearDispatchBatch(root, requestId, generation) {
  if (!/^[a-f0-9-]{36}$/.test(requestId) || !Number.isInteger(generation) || generation < 0) throw new Error('dispatch_progress_invalid')
  rmSync(resolve(root, '.local/education-sync-dispatch/tasks', requestId, `batch-${generation}`), { recursive: true, force: true })
}
