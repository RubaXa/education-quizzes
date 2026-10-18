/** Shared Mesh credentials and single-host advisory account lock.
 * @see ../../docs/shared/server-runtime.md#авторизация-и-совместимость
 */
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { meshParentAccountId, validRuntimeId } from './identity.mjs'

const lockProgram = String.raw`
import fcntl, os, select, sys, time
path, timeout = sys.argv[1], float(sys.argv[2])
fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
os.fchmod(fd, 0o600)
deadline = time.monotonic() + timeout
while True:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except BlockingIOError:
        if time.monotonic() >= deadline:
            print('TIMEOUT', flush=True)
            os.close(fd)
            sys.exit(3)
        readable, _, _ = select.select([sys.stdin], [], [], 0.05)
        if readable and not sys.stdin.readline():
            os.close(fd)
            sys.exit(4)
print('READY', flush=True)
while True:
    readable, _, _ = select.select([sys.stdin], [], [], 3600)
    if readable and not sys.stdin.readline():
        break
os.close(fd)
`

/** A canonical credential store; all writes require a held account lease. */
export function createMeshCredentialStore({ connectionsDir, legacyCodec = null, fs = defaultFs, telemetry = null } = {}) {
  if (typeof connectionsDir !== 'string' || !connectionsDir) throw new Error('mesh_connections_directory_required')
  fs = { ...defaultFs, ...fs }

  function load(accountId, legacyOwner = null, lease = null) {
    if (!validRuntimeId(accountId)) throw safeError('credentials_mismatch')
    const guard = () => {
      if (!lease || typeof lease.assertHeld !== 'function') throw safeError('account_lock_required')
      lease.assertHeld()
    }
    if (legacyOwner !== null) return legacyCodec?.load(accountId, legacyOwner, guard) ?? (() => { throw safeError('credentials_unavailable') })()
    const file = join(connectionsDir, `${accountId}.json`)
    let record
    try { record = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { throw safeError('credentials_unavailable') }
    if (!record?.credentials || meshParentAccountId(record.credentials.actorPersonId) !== accountId) throw safeError('credentials_mismatch')
    let current = { ...record.credentials }
    return { get credentials() { return current }, save: (updated) => {
      guard()
      persistTokens({ file, wrapper: record, credentials: current, updated, fs })
      current = { ...record.credentials }
    } }
  }

  function hasCanonical(accountId) {
    return credentialState(accountId) === 'valid'
  }

  function credentialState(accountId) {
    if (!validRuntimeId(accountId)) return 'invalid'
    try {
      const record = JSON.parse(fs.readFileSync(join(connectionsDir, `${accountId}.json`), 'utf8'))
      return record?.credentials && meshParentAccountId(record.credentials.actorPersonId) === accountId ? 'valid' : 'invalid'
    } catch (error) { return error?.code === 'ENOENT' ? 'missing' : 'invalid' }
  }

  function withAccountLock(accountId, run, options = {}) {
    return withMeshAccountLock(accountId, run, { connectionsDir, telemetry, ...options })
  }

  return Object.freeze({ load, hasCanonical, credentialState, withAccountLock })
}

/** Explicit compatibility codec. Registry authorization is checked by MeshSession before this is called. */
export function createLegacyMeshCredentialCodec({ familyAccessPath, credentialsPath, fs = defaultFs } = {}) {
  if (!familyAccessPath || !credentialsPath) throw new Error('legacy_mesh_paths_required')
  fs = { ...defaultFs, ...fs }
  function describeOwner() {
    try {
      const access = JSON.parse(fs.readFileSync(familyAccessPath, 'utf8'))
      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
      const registered = access?.legacyDayOwner
      const accountId = meshParentAccountId(credentials.actorPersonId)
      if (!registered || !validRuntimeId(registered.familyId) || !validRuntimeId(registered.childId) || !accountId) return null
      return Object.freeze({ kind: 'legacy', familyId: registered.familyId, childId: registered.childId,
        accountId, actorPersonId: credentials.actorPersonId })
    } catch { return null }
  }
  function matches(accountId, owner) {
    const registered = describeOwner()
    return Boolean(registered && owner?.kind === 'legacy' && owner.accountId === accountId
      && registered.accountId === accountId && registered.familyId === owner.familyId && registered.childId === owner.childId)
  }
  return Object.freeze({
    matches,
    describeOwner,
    load(accountId, owner, assertHeld = null) {
      if (!owner || owner.kind !== 'legacy' || !validRuntimeId(owner.familyId) || !validRuntimeId(owner.childId)
        || owner.accountId !== accountId) throw safeError('credentials_mismatch')
      let access, credentials
      try {
        access = JSON.parse(fs.readFileSync(familyAccessPath, 'utf8'))
        credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
      } catch { throw safeError('credentials_unavailable') }
      const registered = access?.legacyDayOwner
      if (!registered || registered.familyId !== owner.familyId || registered.childId !== owner.childId
        || meshParentAccountId(credentials.actorPersonId) !== accountId) throw safeError('credentials_mismatch')
      let current = { ...credentials }
      return { get credentials() { return current }, save: (updated) => {
        if (typeof assertHeld !== 'function') throw safeError('account_lock_required')
        assertHeld()
        persistTokens({ file: credentialsPath, wrapper: null, credentials: current, updated, fs })
        current = { ...credentials }
      } }
    },
  })
}

/**
 * A persistent lock inode guarded by the OS advisory lock. Never unlink or rename it:
 * doing so can split the lock into two inodes while another process holds the old one.
 * @see ../../docs/shared/server-runtime.md#авторизация-и-совместимость
 */
export async function withMeshAccountLock(accountId, run, { connectionsDir, telemetry = null,
  python = 'python3', timeoutMs = 60_000, spawnProcess = spawn, signal = null } = {}) {
  if (!validRuntimeId(accountId) || typeof run !== 'function' || !connectionsDir) throw new Error('invalid_mesh_account_lock')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('invalid_mesh_account_lock_timing')
  if (signal?.aborted) throw safeError('worker_shutdown')
  const locksDir = join(connectionsDir, '.locks')
  mkdirSync(locksDir, { recursive: true, mode: 0o700 })
  const lockPath = join(locksDir, `${accountId}.lock`)
  const started = performance.now()
  const child = spawnProcess(python, ['-c', lockProgram, lockPath, String(timeoutMs / 1000)], { stdio: ['pipe', 'pipe', 'ignore'] })
  let exited = false, intentionalRelease = false
  const controller = new AbortController()
  child.once('exit', () => {
    exited = true
    if (!intentionalRelease) controller.abort(safeError('account_lock_lost'))
  })
  child.once('error', () => {
    exited = true
    if (!intentionalRelease) controller.abort(safeError('account_lock_unavailable'))
  })
  const readline = createInterface({ input: child.stdout })
  try {
    const ready = await telemetrySpan(telemetry, 'mesh.account_lock.wait', () => awaitReady(readline, child, timeoutMs, signal), { source: 'mesh' })
    if (ready !== 'READY') throw safeError(ready === 'TIMEOUT' ? 'account_lock_timeout' : 'account_lock_unavailable')
    const lease = Object.freeze({ signal: controller.signal, assertHeld() {
      if (signal?.aborted) throw safeError('worker_shutdown')
      if (exited || child.exitCode !== null || child.signalCode !== null) throw safeError('account_lock_lost')
    } })
    telemetry?.count?.('mesh.account_lock.wait_ms', Math.max(0, performance.now() - started))
    lease.assertHeld()
    const work = Promise.resolve().then(() => run(lease))
    const lost = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason || safeError('account_lock_lost')), { once: true }))
    let removeShutdownListener = () => {}
    const shutdown = signal ? new Promise((_, reject) => {
      const abort = () => reject(safeError('worker_shutdown'))
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
      removeShutdownListener = () => signal.removeEventListener('abort', abort)
    }) : null
    let result
    try { result = await Promise.race([work, lost, ...(shutdown ? [shutdown] : [])]) }
    catch (error) {
      if (exited || child.exitCode !== null || child.signalCode !== null) throw safeError('account_lock_lost')
      throw error
    } finally { removeShutdownListener() }
    lease.assertHeld()
    return result
  } finally {
    intentionalRelease = true
    readline.close()
    if (!child.stdin.destroyed) child.stdin.end()
    await closeBroker(child)
  }
}

export function persistTokens({ file, wrapper, credentials, updated, fs = defaultFs }) {
  if (!updated || typeof updated.token !== 'string' || !updated.token
    || (updated.refreshToken !== undefined && updated.refreshToken !== null && typeof updated.refreshToken !== 'string')) {
    throw safeError('credential_refresh_invalid')
  }
  const nextCredentials = { ...credentials, token: updated.token }
  if (updated.refreshToken !== undefined) nextCredentials.refreshToken = updated.refreshToken
  const next = wrapper ? { ...wrapper, credentials: nextCredentials } : nextCredentials
  const directory = file.slice(0, file.lastIndexOf('/'))
  const temporary = join(directory, `.${file.split('/').at(-1)}.${randomBytes(8).toString('hex')}.tmp`)
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    fs.chmodSync(temporary, 0o600)
    fs.renameSync(temporary, file)
    fs.chmodSync(file, 0o600)
    if (wrapper) wrapper.credentials = nextCredentials
    else Object.assign(credentials, nextCredentials)
  } catch {
    try { fs.unlinkSync(temporary) } catch { /* cleanup best effort */ }
    throw safeError('credential_refresh_persist_failed')
  }
}

function awaitReady(lines, child, timeoutMs, signal = null) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(safeError('account_lock_timeout')), timeoutMs + 1000)
    const finish = (error, value) => {
      clearTimeout(timer)
      lines.off('line', onLine)
      child.off('error', onError)
      child.off('exit', onExit)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(value)
    }
    const onLine = (line) => finish(null, line)
    const onError = () => finish(safeError('account_lock_unavailable'))
    const onExit = () => finish(safeError('account_lock_unavailable'))
    const onAbort = () => finish(safeError('worker_shutdown'))
    lines.once('line', onLine)
    child.once('error', onError)
    child.once('exit', onExit)
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function closeBroker(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 1000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}
function telemetrySpan(telemetry, operation, work, attributes) {
  return telemetry?.span ? telemetry.span(operation, work, attributes) : work()
}
function safeError(code) { const error = new Error(code); error.code = code; return error }
const defaultFs = { mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, unlinkSync }
