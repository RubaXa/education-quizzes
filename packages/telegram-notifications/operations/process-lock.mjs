/** @see ../../../docs/services/telegram-bot/operations.md */
import { mkdirSync, realpathSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const lockProgram = String.raw`
import fcntl, os, sys, select
path = sys.argv[1]
fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
os.fchmod(fd, 0o600)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    print('LOCKED', flush=True)
    os.close(fd)
    sys.exit(3)
print('READY', flush=True)
while True:
    readable, _, _ = select.select([sys.stdin], [], [], 3600)
    if readable and not sys.stdin.readline():
        break
os.close(fd)
`

/** Hold a persistent advisory lock for the lifetime of the worker. Never unlink the inode. */
export function resolvePythonExecutable(env = process.env, fs = { realpathSync, statSync }) {
  const explicit = env.TELEGRAM_LOCK_PYTHON
  const candidates = explicit ? [explicit] : String(env.PATH ?? '').split(delimiter).filter(Boolean).map((directory) => resolve(directory, 'python3'))
  for (const candidate of candidates) {
    try {
      if (!isAbsolute(candidate)) continue
      const path = fs.realpathSync(candidate)
      const info = fs.statSync(path)
      if (info.isFile() && (info.mode & 0o111) !== 0) return path
    } catch { /* Try the next absolute PATH candidate. */ }
  }
  throw safeError('python_runtime_unavailable')
}

export async function acquireWorkerLock({ stateDirectory, python = resolvePythonExecutable(), spawnProcess = spawn, fs = { mkdirSync } } = {}) {
  if (typeof stateDirectory !== 'string' || !stateDirectory) throw safeError('worker_lock_directory_invalid')
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 })
  const lockPath = join(stateDirectory, 'worker.lock')
  const child = spawnProcess(python, ['-c', lockProgram, lockPath], { stdio: ['pipe', 'pipe', 'ignore'] })
  const readline = createInterface({ input: child.stdout })
  try {
    const result = await waitReady(child, readline)
    if (result !== 'READY') throw safeError(result === 'LOCKED' ? 'worker_already_running' : 'worker_lock_unavailable')
    let released = false
    let lostError = null
    let resolveLost
    const lost = new Promise((resolve) => { resolveLost = resolve })
    const markLost = () => {
      if (released || lostError) return
      lostError = safeError('worker_lock_lost')
      resolveLost(lostError)
    }
    child.once('exit', markLost)
    child.once('error', markLost)
    return Object.freeze({ lost, assertHeld() {
      if (lostError || child.exitCode !== null || child.signalCode !== null) throw lostError ?? safeError('worker_lock_lost')
    }, async release() {
      if (released) return
      released = true
      child.removeListener('exit', markLost)
      child.removeListener('error', markLost)
      readline.close()
      if (!child.stdin.destroyed) child.stdin.end()
      if (child.exitCode !== null || child.signalCode !== null) return
      await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill?.('SIGKILL'); resolve() }, 2_000)
        timer.unref?.()
        child.once('exit', () => { clearTimeout(timer); resolve() })
      })
    } })
  } catch (error) {
    readline.close()
    try { child.kill?.('SIGTERM') } catch { /* best effort */ }
    throw error
  }
}

function waitReady(child, readline) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(() => reject(safeError('worker_lock_unavailable'))), 5_000)
    timer.unref?.()
    const finish = (complete) => { clearTimeout(timer); readline.removeListener('line', onLine); child.removeListener('error', onError); complete() }
    const onLine = (line) => finish(() => resolve(line))
    const onError = () => finish(() => reject(safeError('worker_lock_unavailable')))
    readline.once('line', onLine)
    child.once('error', onError)
  })
}
function safeError(code) { const error = new Error(code); error.safeCode = code; return error }
