import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createLegacyMeshCredentialCodec, createMeshCredentialStore, withMeshAccountLock } from './credentials.mjs'
import { meshParentAccountId } from './identity.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function root() { const path = mkdtempSync(join(tmpdir(), 'education-runtime-')); roots.push(path); return path }

describe('shared Mesh credential store', () => {
  it('persists only token fields atomically with restrictive permissions', async () => {
    const directory = join(root(), 'connections')
    mkdirSync(directory, { mode: 0o700 })
    const actorPersonId = 'synthetic-adult'
    const accountId = meshParentAccountId(actorPersonId)
    const file = join(directory, `${accountId}.json`)
    writeFileSync(file, JSON.stringify({ source: 'mesh', credentials: { actorPersonId, token: 'old', profileId: 'adult-profile', studentId: 'adult-profile' } }))
    const store = createMeshCredentialStore({ connectionsDir: directory })
    let record
    await store.withAccountLock(accountId, async (lease) => {
      record = store.load(accountId, null, lease)
      record.save({ token: 'rotated', profileId: 'child-profile', studentId: 'child-profile', refreshToken: 'new-refresh' })
    })
    const persisted = JSON.parse(readFileSync(file, 'utf8'))
    expect(persisted.credentials).toEqual({ actorPersonId, token: 'rotated', profileId: 'adult-profile', studentId: 'adult-profile', refreshToken: 'new-refresh' })
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(record.credentials.token).toBe('rotated')
  })

  it('uses legacy files only for an explicit exact owner and actor hash', async () => {
    const directory = root()
    const actorPersonId = 'synthetic-legacy-adult'
    const accountId = meshParentAccountId(actorPersonId)
    const familyAccessPath = join(directory, 'family-access.json')
    const credentialsPath = join(directory, 'secret.json')
    writeFileSync(familyAccessPath, JSON.stringify({ legacyDayOwner: { familyId: 'family-a', childId: 'child-a' } }))
    writeFileSync(credentialsPath, JSON.stringify({ actorPersonId, token: 'old', profileId: 'adult-profile' }))
    const legacyCodec = createLegacyMeshCredentialCodec({ familyAccessPath, credentialsPath })
    expect(legacyCodec.describeOwner()).toMatchObject({ kind: 'legacy', accountId, familyId: 'family-a', childId: 'child-a' })
    expect(legacyCodec.matches(accountId, { kind: 'legacy', accountId, familyId: 'family-a', childId: 'child-a' })).toBe(true)
    expect(legacyCodec.matches(accountId, { kind: 'legacy', accountId, familyId: 'family-a', childId: 'other-child' })).toBe(false)
    const store = createMeshCredentialStore({ connectionsDir: join(directory, 'connections'), legacyCodec })
    expect(() => store.load(accountId)).toThrow()
    expect(() => store.load(accountId, { kind: 'legacy', accountId, familyId: 'family-a', childId: 'other-child' })).toThrow()
    await store.withAccountLock(accountId, async (lease) => {
      const legacy = store.load(accountId, { kind: 'legacy', accountId, familyId: 'family-a', childId: 'child-a' }, lease)
      legacy.save({ token: 'new' })
    })
    expect(JSON.parse(readFileSync(credentialsPath, 'utf8'))).toEqual({ actorPersonId, token: 'new', profileId: 'adult-profile' })
  })

  it('refuses token persistence after the account lease is lost', async () => {
    const directory = join(root(), 'connections')
    mkdirSync(directory, { recursive: true })
    const accountId = meshParentAccountId('synthetic-adult')
    const file = join(directory, `${accountId}.json`)
    writeFileSync(file, JSON.stringify({ credentials: { actorPersonId: 'synthetic-adult', token: 'before' } }))
    const store = createMeshCredentialStore({ connectionsDir: directory })
    const record = store.load(accountId, null, { assertHeld() { throw Object.assign(new Error('account_lock_lost'), { code: 'account_lock_lost' }) } })
    expect(() => record.save({ token: 'after' })).toThrow('account_lock_lost')
    expect(JSON.parse(readFileSync(file, 'utf8')).credentials.token).toBe('before')
  })
})

describe('cross-process Mesh account advisory lock', () => {
  it('serializes independent processes on one persistent lock inode', async () => {
    const directory = join(root(), 'connections')
    mkdirSync(directory, { recursive: true })
    const events = join(directory, 'events.log')
    const workerPath = makeWorker(directory)
    const launch = (label, hold) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [workerPath, directory, events, label, String(hold)], { stdio: 'ignore' })
      child.once('error', reject)
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker_exit_${code}`)))
    })
    const first = launch('first', 180)
    await waitFor(() => readFileSync(events, 'utf8').includes('first'))
    const lockPath = join(directory, '.locks', 'synthetic-account.lock')
    const initial = statSync(lockPath).ino
    const old = new Date(Date.now() - 60_000)
    utimesSync(lockPath, old, old)
    const second = launch('second', 10)
    await Promise.all([first, second])
    const rows = readFileSync(events, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(rows.map(({ label, state }) => `${label}:${state}`)).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
    expect(rows[2].at).toBeGreaterThanOrEqual(rows[1].at)
    expect(statSync(lockPath).ino).toBe(initial)
  }, 10_000)

  it('times out without deleting the inode held by another process', async () => {
    const directory = join(root(), 'connections')
    mkdirSync(directory, { recursive: true })
    const workerPath = makeWorker(directory)
    const child = spawn(process.execPath, [workerPath, directory, join(directory, 'events.log'), 'hold', '400'], { stdio: 'ignore' })
    await waitFor(() => readFileSync(join(directory, 'events.log'), 'utf8').includes('hold'))
    const lockPath = join(directory, '.locks', 'synthetic-account.lock')
    const inode = statSync(lockPath).ino
    await expect(withMeshAccountLock('synthetic-account', async () => 'must-not-enter', {
      connectionsDir: directory, timeoutMs: 80,
    })).rejects.toMatchObject({ code: 'account_lock_timeout' })
    expect(statSync(lockPath).ino).toBe(inode)
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
  }, 10_000)

  it('releases the OS lock after owner process death and leaves the lock inode intact', async () => {
    const directory = join(root(), 'connections')
    mkdirSync(directory, { recursive: true })
    const modulePath = fileURLToPath(new URL('./credentials.mjs', import.meta.url))
    const scriptPath = join(directory, 'kill-owner.mjs')
    writeFileSync(scriptPath, `import { appendFileSync } from 'node:fs';
      import { withMeshAccountLock } from ${JSON.stringify(pathToFileURL(modulePath).href)};
      await withMeshAccountLock('synthetic-account', async () => { appendFileSync(process.argv[3], 'held'); return new Promise(() => {}); }, { connectionsDir: process.argv[2] });`)
    const held = join(directory, 'held')
    const child = spawn(process.execPath, [scriptPath, directory, held], { stdio: 'ignore' })
    const lockPath = join(directory, '.locks', 'synthetic-account.lock')
    await waitFor(() => readFileSync(held, 'utf8') === 'held')
    child.kill('SIGKILL')
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
    await expect(withMeshAccountLock('synthetic-account', async () => 'recovered', { connectionsDir: directory }))
      .resolves.toBe('recovered')
    expect(statSync(lockPath).ino).toBeGreaterThan(0)
  }, 10_000)

  it('aborts the lease and rejects an in-flight callback if the broker exits unexpectedly', async () => {
    const directory = join(root(), 'connections')
    let child, leaseSignal
    const spawnProcess = () => {
      child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stdin = new PassThrough()
      child.exitCode = null
      child.signalCode = null
      setImmediate(() => child.stdout.write('READY\n'))
      setTimeout(() => { child.exitCode = 9; child.emit('exit', 9, null) }, 20)
      return child
    }
    await expect(withMeshAccountLock('synthetic-account', async (lease) => {
      leaseSignal = lease.signal
      return new Promise(() => {})
    }, { connectionsDir: directory, spawnProcess })).rejects.toMatchObject({ code: 'account_lock_lost' })
    expect(leaseSignal.aborted).toBe(true)
  })

  it('cancels lock work and prevents a late callback from saving after shutdown', async () => {
    const directory = join(root(), 'connections')
    mkdirSync(directory, { recursive: true })
    const accountId = meshParentAccountId('synthetic-adult')
    const file = join(directory, `${accountId}.json`)
    writeFileSync(file, JSON.stringify({ credentials: { actorPersonId: 'synthetic-adult', token: 'before' } }))
    const store = createMeshCredentialStore({ connectionsDir: directory })
    const controller = new AbortController()
    let child, releaseCallback, lateSaveResult
    const spawnProcess = () => {
      child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stdin = new PassThrough()
      child.exitCode = null
      child.signalCode = null
      child.kill = () => { child.exitCode = 0; child.emit('exit', 0, null) }
      child.stdin.once('finish', () => { child.exitCode = 0; child.emit('exit', 0, null) })
      setImmediate(() => child.stdout.write('READY\n'))
      return child
    }
    const operation = store.withAccountLock(accountId, async (lease) => {
      const record = store.load(accountId, null, lease)
      await new Promise((resolve) => { releaseCallback = resolve })
      try { record.save({ token: 'late' }); lateSaveResult = 'saved' }
      catch (error) { lateSaveResult = error.code }
    }, { signal: controller.signal, spawnProcess })
    await waitFor(() => typeof releaseCallback === 'function')
    controller.abort()
    await expect(operation).rejects.toMatchObject({ code: 'worker_shutdown' })
    releaseCallback()
    await new Promise((resolve) => setImmediate(resolve))
    expect(lateSaveResult).toBe('worker_shutdown')
    expect(JSON.parse(readFileSync(file, 'utf8')).credentials.token).toBe('before')
  })
})

function makeWorker(directory) {
  const modulePath = fileURLToPath(new URL('./credentials.mjs', import.meta.url))
  const workerPath = join(directory, 'worker.mjs')
  writeFileSync(workerPath, `import { appendFileSync } from 'node:fs';
    import { withMeshAccountLock } from ${JSON.stringify(pathToFileURL(modulePath).href)};
    const [dir, log, label, hold] = process.argv.slice(2);
    await withMeshAccountLock('synthetic-account', async () => {
      appendFileSync(log, JSON.stringify({ label, state: 'start', at: Date.now() }) + '\\n');
      await new Promise(resolve => setTimeout(resolve, Number(hold)));
      appendFileSync(log, JSON.stringify({ label, state: 'end', at: Date.now() }) + '\\n');
    }, { connectionsDir: dir, timeoutMs: 3000 });`)
  return workerPath
}

async function waitFor(predicate) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    try { if (predicate()) return } catch { /* first worker has not created its marker */ }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('worker_start_timeout')
}
