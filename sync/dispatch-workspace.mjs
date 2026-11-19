/** @see ../docs/decisions/sync-claim-liveness-2026-11-19.md */
/** @see ../docs/decisions/sync-single-drainer-2026-11-05.md */
/** Private projections of the server lease; never a second queue or source of authority.
 * @see ../docs/services/telegram-bot/education-sync-dispatch.md#single-drainer */
import { mkdirSync, writeFileSync, renameSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export const WORK_PHASES = ['claimed', 'inventory', 'inbox', 'mesh', 'sources', 'review', 'publication', 'verifying', 'waiting', 'completed', 'failed', 'blocked']
export const STALLED_AFTER_MS = 5 * 60_000
export function dispatchLiveness(execution, now = new Date().toISOString()) {
  const lastReactionAt = [execution?.claimedAt, execution?.heartbeatAt]
    .filter(value => typeof value === 'string' && Number.isFinite(Date.parse(value))).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1) ?? null
  const silentForMs = lastReactionAt ? Math.max(0, Date.parse(now)-Date.parse(lastReactionAt)) : null
  const state = execution?.status === 'running'
    ? silentForMs === null ? 'unknown' : silentForMs >= STALLED_AFTER_MS ? 'stalled' : 'active'
    : ['completed','blocked','failed'].includes(execution?.status) ? 'closed' : 'waiting'
  return {state,lastReactionAt,silentForMs,stalledAfterMs:STALLED_AFTER_MS}
}

/** A worker tick is observation, never evidence of agent activity or authority to take over. */
export function observeDispatchProgress(root, execution, {now = new Date().toISOString(),pid = process.pid} = {}) {
  if (!/^[a-f0-9-]{36}$/.test(execution?.requestId ?? '')) return null
  const directory=resolve(root,'.local/education-sync-dispatch/work',execution.requestId)
  mkdirSync(directory,{recursive:true,mode:0o700})
  const value={requestId:execution.requestId,...dispatchLiveness(execution,now),checkedAt:now,workerPid:pid}
  const path=resolve(directory,'health.json'),temporary=`${path}.${randomUUID()}.tmp`
  let previous
  try {previous=JSON.parse(readFileSync(path,'utf8'))} catch { /* First worker observation. */ }
  try {writeFileSync(temporary,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});renameSync(temporary,path)}
  finally {rmSync(temporary,{force:true})}
  return {...value,stateChanged:previous?.state!==value.state}
}

export function readDispatchProgress(root,requestId) {
  const path=resolve(root,'.local/education-sync-dispatch/work',requestId,'progress.json')
  try {const value=JSON.parse(readFileSync(path,'utf8'));return value.requestId===requestId?value:null}
  catch {return null}
}
export function writeDispatchProgress(root, requestId, patch) {
  if (!/^[a-f0-9-]{36}$/.test(requestId) || !WORK_PHASES.includes(patch.phase)) throw new Error('dispatch_progress_invalid')
  const path = resolve(root, '.local/education-sync-dispatch/work', requestId, 'progress.json')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  const allowed = Object.fromEntries(['phase', 'generation', 'manifestPath', 'completedGeneration'].filter(k => patch[k] !== undefined).map(k => [k, patch[k]]))
  const updatedAt=new Date().toISOString()
  const value = { ...previous, ...allowed, requestId, updatedAt, lastReactionAt:updatedAt }
  const temporary = `${path}.${randomUUID()}.tmp`
  try { writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temporary, path) }
  finally { rmSync(temporary, { force: true }) }
  if(['completed','failed','blocked'].includes(value.phase)) observeDispatchProgress(root,{requestId,status:value.phase,heartbeatAt:updatedAt},{now:updatedAt,pid:null})
  return path
}

// Only call after the server acknowledges the exact batch. Sources/uploads remain in their own stores.
export function clearDispatchBatch(root, requestId, generation) {
  if (!/^[a-f0-9-]{36}$/.test(requestId) || !Number.isInteger(generation) || generation < 0) throw new Error('dispatch_progress_invalid')
  rmSync(resolve(root, '.local/education-sync-dispatch/tasks', requestId, `batch-${generation}`), { recursive: true, force: true })
}
