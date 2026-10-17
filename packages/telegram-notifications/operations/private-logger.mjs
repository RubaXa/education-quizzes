/** @see ../../../docs/services/telegram-bot/operations.md */
import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const SAFE_OPERATION_CODES = new Set([
  'source_port_unavailable', 'source_pipeline_unavailable', 'checkpoint_port_unavailable', 'invalid_source_pipeline_config',
  'invalid_source_origin', 'source_signal_handler_failed', 'source_listener_unavailable', 'source_observation_failed',
  'dependency_unavailable', 'unavailable', 'deadline-exceeded', 'resource-exhausted', 'permission-denied',
  'failed-precondition', 'aborted', 'cancelled', 'not-found', 'unauthenticated', 'internal', 'source_error',
  'scope_unavailable', 'credentials_unavailable', 'credentials_mismatch', 'mesh_unavailable', 'mesh_incomplete',
  'mesh_access_unverified', 'child_profile_unavailable', 'scope_changed', 'credential_refresh_invalid',
  'credential_refresh_persist_failed', 'source_grade_inventory_invalid', 'account_lock_lost', 'worker_shutdown',
  'account_lock_timeout', 'account_lock_unavailable', 'inventory_read_failed', 'family_graph_read_failed',
])
const SAFE_REASON_CODES = new Set(['source_snapshot_incomplete', 'source_snapshot_too_large'])

/** Strict operational facts shared by stdout and private file logs; never includes IDs, errors, or messages. */
export function sanitizeOperationalLog(input = {}) {
  const row = {}
  if (typeof input.code === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(input.code)) row.code = input.code
  for (const key of ['deliveryEnabled', 'firestoreSourceEnabled', 'meshSourceEnabled', 'hasMeshIdentity', 'hasMeshAccount']) {
    if (typeof input[key] === 'boolean') row[key] = input[key]
  }
  if (typeof input.scopeKey === 'string' && /^[a-f0-9]{64}$/.test(input.scopeKey)) row.scopeKey = input.scopeKey
  for (const key of ['errorCode', 'reasonCode']) {
    const allowed = key === 'reasonCode' ? SAFE_REASON_CODES : SAFE_OPERATION_CODES
    if (typeof input[key] === 'string' && allowed.has(input[key])) row[key] = input[key]
  }
  if (['firestore', 'mesh', 'unknown'].includes(input.source)) row.source = input.source
  if (Number.isSafeInteger(input.failedFamilies) && input.failedFamilies >= 0) row.failedFamilies = input.failedFamilies
  return row
}

/** Private size-rotated JSONL logger with a strict field allowlist. */
export function createPrivateLogger(path, { fs = { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, statSync }, maxBytes = 2 * 1024 * 1024, maxFiles = 3 } = {}) {
  const target = resolve(path)
  const safe = (level, input = {}) => {
    const row = { at: new Date().toISOString(), level, ...sanitizeOperationalLog(input) }
    fs.mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    const line = `${JSON.stringify(row)}\n`
    const size = fs.existsSync(target) ? fs.statSync(target).size : 0
    if (size + Buffer.byteLength(line) > maxBytes) {
      for (let index = maxFiles - 2; index >= 1; index -= 1) {
        const from = `${target}.${index}`
        const to = `${target}.${index + 1}`
        if (fs.existsSync(from)) { fs.renameSync(from, to); fs.chmodSync(to, 0o600) }
      }
      if (fs.existsSync(target)) { fs.renameSync(target, `${target}.1`); fs.chmodSync(`${target}.1`, 0o600) }
    }
    fs.appendFileSync(target, line, { mode: 0o600 })
    fs.chmodSync(target, 0o600)
  }
  return Object.freeze({ info: (data) => safe('info', data), error: (data) => safe('error', data) })
}
