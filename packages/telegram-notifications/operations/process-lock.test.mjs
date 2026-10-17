import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { acquireWorkerLock } from './process-lock.mjs'

const directories = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('worker singleton lock', () => {
  it('holds an OS lock across processes and can be reacquired after release', async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), 'telegram-worker-lock-'))
    directories.push(stateDirectory)
    const first = await acquireWorkerLock({ stateDirectory })
    await expect(acquireWorkerLock({ stateDirectory })).rejects.toMatchObject({ safeCode: 'worker_already_running' })
    await first.release()
    const second = await acquireWorkerLock({ stateDirectory })
    await second.release()
  }, 10_000)

  it('reports broker death after READY so the worker can stop before another instance proceeds', async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), 'telegram-worker-lock-loss-'))
    directories.push(stateDirectory)
    let broker
    const first = await acquireWorkerLock({ stateDirectory, spawnProcess: (...args) => (broker = spawn(...args)) })
    broker.kill('SIGKILL')
    await expect(first.lost).resolves.toMatchObject({ safeCode: 'worker_lock_lost' })
    expect(() => first.assertHeld()).toThrow('worker_lock_lost')
    const second = await acquireWorkerLock({ stateDirectory })
    await second.release()
    await first.release()
  }, 10_000)
})
