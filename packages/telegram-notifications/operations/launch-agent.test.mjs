import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createLaunchAgentOperations, dependencyClosure, makePlist, PERMANENT_WORKER_ARGUMENTS,
  LEGACY_UPLOAD_SERVICE_LABEL, retireLegacyUploadWorker } from './launch-agent.mjs'
import { parseBotArguments } from '../../../scripts/telegram-bot.mjs'

const roots = []
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'telegram-launch-test-'))
  roots.push(base)
  const root = join(base, 'repo'), home = join(base, 'home')
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, '.local'), { recursive: true })
  mkdirSync(join(root, '.local/diary'), { recursive: true })
  writeFileSync(join(root, 'scripts/telegram-bot.mjs'), "import './lib.mjs'\n")
  writeFileSync(join(root, 'scripts/lib.mjs'), 'export const ready = true\n')
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  writeFileSync(join(root, 'package-lock.json'), '{}')
  const runtime = join(root, 'packages/telegram-notifications/runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'package.json'), '{"type":"module"}')
  writeFileSync(join(runtime, 'package-lock.json'), '{}')
  writeFileSync(join(root, '.firebaserc'), JSON.stringify({ projects: { default: 'education-9d7c6' } }))
  const adcPath = join(root, '.local/adc.json')
  const diskTokenPath = join(root, '.local/yandex-disk-token')
  writeFileSync(adcPath, '{}', { mode: 0o600 })
  writeFileSync(diskTokenPath, 'private-disk-token', { mode: 0o600 })
  writeFileSync(join(root, '.local/family-access.json'), '{}', { mode: 0o600 })
  writeFileSync(join(root, '.local/diary/secret.json'), '{}', { mode: 0o600 })
  return { base, root, home, adcPath, diskTokenPath }
}

describe('launch agent release operations', () => {
  it('persists only the bounded opt-in IPv4 setting and rejects unknown values', () => {
    const f = fixture()
    const base = { root: f.root, home: f.home, uid: statSync(f.adcPath).uid, platform: 'darwin',
      nodePath: process.execPath, pythonPath: process.execPath, npmCliPath: process.execPath,
      waitForQueueReady: () => true, exec: (_binary, args) => { if (args[0] === 'print') throw Error('not loaded') } }
    const env = { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath,
      TELEGRAM_IPV4_FIRST: '1', NODE_OPTIONS: '--trace-warnings' }
    const ops = createLaunchAgentOperations({ ...base, env })
    ops.install({ apply: true })
    const plist = readFileSync(ops.paths.plistPath, 'utf8')
    expect(plist).toContain('<key>TELEGRAM_IPV4_FIRST</key><string>1</string>')
    expect(plist).toContain('--no-network-family-autoselection --dns-result-order=ipv4first')
    expect(plist).not.toContain('--trace-warnings')
    expect(() => createLaunchAgentOperations({ ...base, env: { ...env, TELEGRAM_IPV4_FIRST: 'anything' } }).plan()).toThrow('network_family_config_invalid')
  })

  it('does not certify a merely loaded, non-running prior release or clean it on a later sync', () => {
    const f = fixture(); let loaded = false, running = false, ops
    ops = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid,
      platform: 'darwin', nodePath: process.execPath, pythonPath: process.execPath, npmCliPath: process.execPath,
      env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath },
      waitForQueueReady: () => true,
      exec: (binary, args) => {
        if (binary === '/bin/ps') return readFileSync(ops.paths.plistPath, 'utf8')
        if (args[0] === 'print') {
          if (!loaded || args[1].includes('upload-worker')) throw Error('not loaded')
          return running ? 'state = running\npid = 42' : 'state = waiting'
        }
        if (args[0] === 'bootout') loaded = false
        if (args[0] === 'bootstrap') { loaded = true; running = true }
      } })
    const first = ops.install({ apply: true })
    running = false
    writeFileSync(join(f.root, 'scripts/lib.mjs'), 'export const revision = 2\n')
    const second = ops.install({ apply: true })
    expect(second.retention).toEqual({ applied: false, error: 'release_backup_preflight_failed' })
    expect(() => ops.cleanup({ apply: true })).toThrow('release_backup_unverified')
    expect([first.releasePath, second.releasePath].every(existsSync)).toBe(true)
  })
  it('retains a live legacy release with the old web manifest as rollback during migration', () => {
    const f = fixture()
    writeFileSync(join(f.root, 'package.json'), '{"type":"module","dependencies":{"react":"19.2.8"}}')
    const files = [...dependencyClosure(f.root), 'package.json', 'package-lock.json'].sort()
    const digest = createHash('sha256')
    for (const file of files) digest.update(file).update('\0').update(readFileSync(join(f.root, file))).update('\0')
    const legacyHash = digest.digest('hex').slice(0, 24)
    const support = join(f.home, 'Library/Application Support/PETR/telegram-worker')
    const legacyPath = join(support, 'releases', legacyHash)
    for (const file of files) {
      const target = join(legacyPath, file)
      mkdirSync(resolve(target, '..'), { recursive: true })
      writeFileSync(target, readFileSync(join(f.root, file)))
    }
    let loaded = true, ops
    ops = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid,
      platform: 'darwin', nodePath: process.execPath, pythonPath: process.execPath, npmCliPath: process.execPath,
      env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath },
      waitForQueueReady: () => true,
      exec: (binary, args) => {
        if (binary === '/bin/ps') return readFileSync(ops.paths.plistPath, 'utf8')
        if (args[0] === 'print') {
          if (!loaded || args[1].includes('upload-worker')) throw Error('not loaded')
          return 'state = running\npid = 42'
        }
        if (args[0] === 'bootout') loaded = false
        if (args[0] === 'bootstrap') loaded = true
      } })
    mkdirSync(resolve(ops.paths.plistPath, '..'), { recursive: true })
    writeFileSync(ops.paths.plistPath, makePlist({ label: 'legacy', nodePath: process.execPath,
      scriptPath: join(legacyPath, 'scripts/telegram-bot.mjs'), args: [], workingDirectory: legacyPath, environment: {}, logPath: '/dev/null' }))
    const installed = ops.install({ apply: true })
    expect(installed.releaseHash).not.toBe(legacyHash)
    expect(installed.retention).toMatchObject({ applied: true, active: installed.releaseHash, backup: legacyHash, removed: [] })
    expect(existsSync(legacyPath)).toBe(true)
    expect(ops.cleanup()).toMatchObject({ applied: false, backup: legacyHash, removed: [] })
  })
  it('installs only its runtime manifest and ignores unrelated web dependency changes in the hash', () => {
    const f = fixture()
    const runtime = join(f.root, 'packages/telegram-notifications/runtime')
    mkdirSync(runtime, { recursive: true })
    const manifest = JSON.stringify({ name: 'education-worker-runtime', private: true, type: 'module', dependencies: { grammy: '1.46.0' } })
    writeFileSync(join(runtime, 'package.json'), manifest)
    writeFileSync(join(runtime, 'package-lock.json'), '{"lockfileVersion":3}')
    const ops = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid,
      platform: 'darwin', nodePath: process.execPath, pythonPath: process.execPath, npmCliPath: process.execPath,
      env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath },
      waitForQueueReady: () => true, exec: (_binary, args) => { if (args[0] === 'print') throw Error('not loaded') } })
    const initial = ops.plan()
    writeFileSync(join(f.root, 'package.json'), '{"dependencies":{"react":"99.0.0"},"scripts":{"prepare":"unexpected"}}')
    expect(ops.plan().releaseHash).toBe(initial.releaseHash)
    const installed = ops.install({ apply: true })
    expect(readFileSync(join(installed.releasePath, 'package.json'), 'utf8')).toBe(manifest)
    expect(readFileSync(join(installed.releasePath, 'package-lock.json'), 'utf8')).toBe('{"lockfileVersion":3}')
    writeFileSync(join(runtime, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}')
    expect(ops.plan().releaseHash).not.toBe(initial.releaseHash)
  })

  it('rotates only after readiness, retains the previous healthy version and preserves all trees on rollback', () => {
    const f = fixture(); let loaded = false, ready = true, blockedPreflightPath = null, waiting = false
    let operations
    operations = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid,
      platform: 'darwin', nodePath: process.execPath, pythonPath: process.execPath, npmCliPath: process.execPath,
      env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath },
      waitForQueueReady: () => ready,
      exec: (binary, args, options) => {
        if (args[0] === '--input-type=module' && options.cwd === blockedPreflightPath) throw Error('backup preflight failed')
        if (binary === '/bin/ps') return readFileSync(operations.paths.plistPath, 'utf8')
        if (args[0] === 'print') {
          if (!loaded || args[1].includes('upload-worker')) throw Error('not loaded')
          return waiting ? 'state = waiting' : 'state = running\npid = 42'
        }
        if (args[0] === 'bootout') loaded = false
        if (args[0] === 'bootstrap') { loaded = true; waiting = false }
      } })
    const first = operations.install({ apply: true })
    writeFileSync(join(f.root, 'scripts/lib.mjs'), 'export const revision = 2\n')
    const second = operations.install({ apply: true })
    expect(second.retention).toMatchObject({ applied: true, backup: first.releaseHash, removed: [] })
    writeFileSync(join(f.root, 'scripts/lib.mjs'), 'export const revision = 3\n')
    const third = operations.install({ apply: true })
    expect(third.retention.removed.map(row => row.hash)).toEqual([first.releaseHash])
    expect(third.retention.backup).toBe(second.releaseHash)
    waiting = true
    const recovered = operations.install({ apply: true })
    expect(recovered.releaseHash).toBe(third.releaseHash)
    expect(recovered.retention).toMatchObject({ applied: true, backup: second.releaseHash, removed: [] })
    ready = false
    writeFileSync(join(f.root, 'scripts/lib.mjs'), 'export const revision = 4\n')
    const failedPath = operations.plan().releasePath
    expect(() => operations.install({ apply: true })).toThrow('education_event_queue_readiness_timeout')
    expect([second.releasePath, third.releasePath, failedPath].every(existsSync)).toBe(true)
    expect(readFileSync(operations.paths.plistPath, 'utf8')).toContain(third.releasePath)
    ready = true
    blockedPreflightPath = third.releasePath
    writeFileSync(join(f.root, 'scripts/lib.mjs'), 'export const revision = 5\n')
    const unverified = operations.install({ apply: true })
    expect(unverified.retention).toEqual({ applied: false, error: 'release_backup_preflight_failed' })
    expect([second.releasePath, third.releasePath, failedPath, unverified.releasePath].every(existsSync)).toBe(true)
    expect(() => operations.cleanup({ apply: true })).toThrow('release_backup_unverified')
    expect([second.releasePath, third.releasePath, failedPath, unverified.releasePath].every(existsSync)).toBe(true)
  })
  it('computes only a safe dry-run plan and keeps secrets out of plist text', () => {
    const f = fixture()
    const secret = '123456:abcdefghijklmnopqrstuvwx'
    const operations = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid, platform: 'darwin',
      nodePath: '/node24', npmCliPath: process.execPath, pythonPath: process.execPath,
      env: { AGI_EDU_BOT: secret, GOOGLE_APPLICATION_CREDENTIALS: f.adcPath } })
    const plan = operations.install()
    expect(plan).toMatchObject({ applied: false, projectId: 'education-9d7c6', fileCount: 2 })
    expect(existsSync(operations.paths.plistPath)).toBe(false)
    const plist = makePlist({ label: 'x', nodePath: '/node24', scriptPath: '/release/bot.mjs', args: ['worker'],
      workingDirectory: '/release', environment: { TELEGRAM_TOKEN_FILE: '/private/token' }, logPath: '/dev/null' })
    expect(plist).toContain('/private/token')
    expect(plist).not.toContain(secret)
  })

  it('uses npm_execpath when Homebrew Node keeps npm outside its versioned Cellar directory', () => {
    const f = fixture()
    const npmCliPath = join(f.base, 'npm-cli.js')
    writeFileSync(npmCliPath, 'export {}\n')
    const operations = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid, platform: 'darwin',
      nodePath: '/opt/homebrew/Cellar/node/26.5.0/bin/node', pythonPath: process.execPath,
      env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath,
        npm_execpath: npmCliPath } })
    expect(operations.install()).toMatchObject({ applied: false, projectId: 'education-9d7c6' })
  })

  it('copies the complete local import closure and writes a private token outside the release', () => {
    const f = fixture()
    const secret = '123456:abcdefghijklmnopqrstuvwx'
    const calls = []
    const operations = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid, platform: 'darwin',
      nodePath: process.execPath, npmCliPath: process.execPath, pythonPath: process.execPath,
      env: { AGI_EDU_BOT: secret, GOOGLE_APPLICATION_CREDENTIALS: f.adcPath,
        EDUCATION_SYNC_CODEX_PATH: process.execPath, EDUCATION_SYNC_THREAD_ID: '01a150dc-e067-7cc2-b08f-f573bf83e6e3',
        EDUCATION_SYNC_PROJECT_ROOT: f.root },
      waitForQueueReady: () => true,
      exec: (...args) => { if (args[1][0] === 'print') throw Object.assign(new Error('not loaded'), { status: 3 }); calls.push(args) } })
    const result = operations.install({ apply: true })
    const plist = readFileSync(operations.paths.plistPath, 'utf8')
    expect(result).toMatchObject({ applied: true, state: 'bootstrapped' })
    expect(existsSync(resolve(result.releasePath, 'scripts/lib.mjs'))).toBe(true)
    expect(readFileSync(result.tokenPath, 'utf8').trim()).toBe(secret)
    expect(statSync(result.tokenPath).mode & 0o077).toBe(0)
    expect(plist).not.toContain(secret)
    expect(plist).toContain(result.tokenPath)
    expect(plist).toContain('<key>EDUCATION_SYNC_CODEX_PATH</key>')
    expect(plist).toContain('<key>EDUCATION_SYNC_THREAD_ID</key>')
    expect(plist).toContain('<key>EDUCATION_SYNC_PROJECT_ROOT</key>')
    expect(plist).toContain(`<key>EDUCATION_YANDEX_DISK_TOKEN_FILE</key><string>${f.diskTokenPath}</string>`)
    expect(plist).toContain(process.execPath)
    expect(calls.map((call) => call[1][0])).toEqual([process.execPath, '--input-type=module', 'bootstrap'])
    expect(calls[0][1]).toContain('--ignore-scripts')
    const preflightCall = calls[1]
    const preflightSource = preflightCall[1][2]
    expect(preflightSource).toContain('createRuntime')
    expect(preflightSource).toContain('createTelemetryFromEnvironment')
    expect(preflightSource).toContain('new YandexDiskStorage')
    expect(preflightSource).toContain('enableFirestoreSource: true')
    expect(preflightSource).toContain('enableMeshSource: true')
    expect(preflightSource).toContain('enableDelivery: true')
    expect(preflightSource).toContain('await runtime.db.terminate()')
    expect(preflightSource).not.toContain(secret)
    expect(preflightCall[2].env).toMatchObject({ GOOGLE_APPLICATION_CREDENTIALS: f.adcPath,
      TELEGRAM_PREFLIGHT_PROJECT_ID: 'education-9d7c6', TELEGRAM_PREFLIGHT_MESH_DIRECTORY: resolve(f.root, '.local/mesh-connections') })
    expect(parseBotArguments(PERMANENT_WORKER_ARGUMENTS)).toEqual({ command: 'worker', workerFlags: {
      enableDelivery: true, enableFirestoreSource: true, enableMeshSource: true,
    } })
    expect(plist).toContain('<key>ExitTimeOut</key><integer>35</integer>')
  })

  it('retains validated EducationSync settings across an environment-free reinstall', () => {
    const f = fixture()
    let loaded = false
    const exec = (_binary, args) => {
      if (args[0] === 'print') {
        if (args[1]?.endsWith(LEGACY_UPLOAD_SERVICE_LABEL) || !loaded) throw Object.assign(new Error('not loaded'), { status: 3 })
        return 'state = running\npid = 42'
      }
      if (args[0] === 'bootout') loaded = false
      if (args[0] === 'bootstrap') loaded = true
      return ''
    }
    const common = { root: f.root, home: f.home, uid: statSync(f.adcPath).uid, platform: 'darwin',
      nodePath: process.execPath, npmCliPath: process.execPath, pythonPath: process.execPath,
      waitForQueueReady: () => true, exec }
    const first = createLaunchAgentOperations({ ...common, env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx',
      GOOGLE_APPLICATION_CREDENTIALS: f.adcPath, EDUCATION_SYNC_CODEX_PATH: process.execPath,
      EDUCATION_SYNC_THREAD_ID: '01a150dc-e067-7cc2-b08f-f573bf83e6e3', EDUCATION_SYNC_PROJECT_ROOT: f.root,
      EDUCATION_SYNC_REMOTE: 'unix:///tmp/codex.sock' } })
    expect(first.install({ apply: true })).toMatchObject({ applied: true, educationSyncConfigured: true })
    expect(statSync(first.paths.educationSyncConfigPath).mode & 0o077).toBe(0)

    const second = createLaunchAgentOperations({ ...common, env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx',
      GOOGLE_APPLICATION_CREDENTIALS: f.adcPath } })
    expect(second.install({ apply: true })).toMatchObject({ applied: true, educationSyncConfigured: true })
    const plist = readFileSync(second.paths.plistPath, 'utf8')
    expect(plist).toContain(`<key>EDUCATION_SYNC_CODEX_PATH</key><string>${process.execPath}</string>`)
    expect(plist).toContain('<key>EDUCATION_SYNC_THREAD_ID</key><string>01a150dc-e067-7cc2-b08f-f573bf83e6e3</string>')
    expect(plist).toContain(`<key>EDUCATION_SYNC_PROJECT_ROOT</key><string>${f.root}</string>`)
    expect(plist).toContain('<key>EDUCATION_SYNC_REMOTE</key><string>unix:///tmp/codex.sock</string>')
  })

  it('fails on partial explicit or invalid persisted EducationSync configuration', () => {
    const f = fixture()
    const common = { root: f.root, home: f.home, uid: statSync(f.adcPath).uid, platform: 'darwin',
      pythonPath: process.execPath, npmCliPath: process.execPath,
      env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath } }
    const partial = createLaunchAgentOperations({ ...common, env: { ...common.env, EDUCATION_SYNC_CODEX_PATH: process.execPath } })
    expect(() => partial.plan()).toThrow('education_sync_config_unavailable')

    mkdirSync(partial.paths.support, { recursive: true })
    writeFileSync(partial.paths.educationSyncConfigPath, JSON.stringify({ codexPath: process.execPath,
      threadId: 'not-a-uuid', projectRoot: f.root }), { mode: 0o600 })
    const noExplicitConfig = createLaunchAgentOperations(common)
    expect(() => noExplicitConfig.plan()).toThrow('education_sync_config_unavailable')
  })

  it('returns a narrow launchctl status and removes only the plist on uninstall', () => {
    const f = fixture()
    const operations = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid, platform: 'darwin',
      pythonPath: process.execPath, npmCliPath: process.execPath,
      env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath },
      exec: () => 'state = running\npid = 42\nsecret should never escape' })
    mkdirSync(join(f.home, 'Library/LaunchAgents'), { recursive: true })
    writeFileSync(operations.paths.plistPath, 'plist')
    expect(operations.status()).toEqual({ installed: true, loaded: true, running: true, state: 'running', pid: 42 })
    expect(operations.uninstall()).toMatchObject({ applied: false, releaseRetained: true })
  })

  it('waits for the old launchd label to unload and retries a transient bootstrap busy result', () => {
    const f = fixture()
    let loaded = true, prints = 0, bootstrapAttempts = 0, waits = 0
    const operations = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid,
      platform: 'darwin', pythonPath: process.execPath, npmCliPath: process.execPath,
      env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath },
      waitForQueueReady: () => true,
      sleep: () => { waits++ },
      exec: (_binary, args) => {
        if (args[0] === 'print') {
          if (args[1]?.endsWith(LEGACY_UPLOAD_SERVICE_LABEL)) throw Object.assign(new Error('not loaded'), { status: 3 })
          prints++
          if (prints > 1 && prints < 3) return 'state = running\npid = 42'
          if (prints >= 3) loaded = false
          if (!loaded) throw Object.assign(new Error('not loaded'), { status: 3 })
          return 'state = running\npid = 42'
        }
        if (args[0] === 'bootout') return
        if (args[0] === 'bootstrap' && ++bootstrapAttempts === 1) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
        if (args[0] === 'bootstrap') loaded = true
      } })
    mkdirSync(join(f.home, 'Library/LaunchAgents'), { recursive: true })
    writeFileSync(operations.paths.plistPath, 'old plist')
    const result = operations.install({ apply: true })
    expect(result).toMatchObject({ applied: true, state: 'bootstrapped' })
    expect(bootstrapAttempts).toBe(2)
    expect(waits).toBeGreaterThanOrEqual(2)
  })

  it('restores the prior plist and exposes unloaded status when bootstrap keeps failing', () => {
    const f = fixture()
    let loaded = true
    const operations = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid,
      platform: 'darwin', pythonPath: process.execPath, npmCliPath: process.execPath,
      env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath },
      waitForQueueReady: () => true,
      sleep: () => {},
      exec: (_binary, args) => {
        if (args[0] === 'print') {
          if (loaded) return 'state = running\npid = 42'
          throw Object.assign(new Error('not loaded'), { status: 3 })
        }
        if (args[0] === 'bootout') { loaded = false; return }
        if (args[0] === 'bootstrap') throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      } })
    mkdirSync(join(f.home, 'Library/LaunchAgents'), { recursive: true })
    writeFileSync(operations.paths.plistPath, 'prior plist')
    expect(() => operations.install({ apply: true })).toThrow('launchagent_bootstrap_failed')
    expect(readFileSync(operations.paths.plistPath, 'utf8')).toBe('prior plist')
    expect(operations.status()).toMatchObject({ installed: true, loaded: false, running: false })
  })

  it('runs production assembly preflight before stopping the prior bot', () => {
    const f = fixture()
    const launchAgents = join(f.home, 'Library/LaunchAgents')
    mkdirSync(launchAgents, { recursive: true })
    writeFileSync(join(launchAgents, 'com.petr.education.telegram-worker.plist'), 'prior bot plist')
    const calls = []
    const operations = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid,
      platform: 'darwin', pythonPath: process.execPath, npmCliPath: process.execPath,
      env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath },
      exec: (_binary, args) => {
        calls.push(args)
        if (args[0] === 'print') return 'state = running\\npid = 42'
        if (args.includes('-e')) throw new Error('private module load failure')
      } })
    expect(() => operations.install({ apply: true })).toThrow('runtime_preflight_failed')
    expect(calls.some((args) => args[0] === 'bootout')).toBe(false)
    expect(readFileSync(operations.paths.plistPath, 'utf8')).toBe('prior bot plist')
  })

  it.each([
    ['false', () => false],
    ['throws', () => { throw new Error('private readiness detail') }],
  ])('restores and reloads the prior bot release when readiness %s', (_name, waitForQueueReady) => {
    const f = fixture()
    const launchAgents = join(f.home, 'Library/LaunchAgents')
    mkdirSync(launchAgents, { recursive: true })
    let loaded = true
    const bootouts = [], bootstraps = []
    const operations = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid,
      platform: 'darwin', pythonPath: process.execPath, npmCliPath: process.execPath,
      env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath },
      waitForQueueReady,
      exec: (_binary, args) => {
        if (args[0] === 'print') {
          if (loaded) return 'state = running\npid = 4242'
          throw Object.assign(new Error('not loaded'), { status: 3 })
        }
        if (args[0] === 'bootout') { bootouts.push(args[1]); loaded = false }
        if (args[0] === 'bootstrap') {
          bootstraps.push(readFileSync(operations.paths.plistPath, 'utf8'))
          loaded = true
        }
      } })
    writeFileSync(operations.paths.plistPath, 'prior bot plist')

    expect(() => operations.install({ apply: true })).toThrow('education_event_queue_readiness_timeout')
    expect(readFileSync(operations.paths.plistPath, 'utf8')).toBe('prior bot plist')
    expect(operations.status()).toMatchObject({ installed: true, loaded: true, running: true })
    expect(bootouts).toHaveLength(2)
    expect(bootstraps).toHaveLength(2)
    expect(bootstraps[0]).not.toBe('prior bot plist')
    expect(bootstraps[1]).toBe('prior bot plist')
  })

  it('retires the legacy upload agent idempotently and preserves its plist as disabled', () => {
    const f = fixture()
    const launchAgents = join(f.home, 'Library/LaunchAgents')
    mkdirSync(launchAgents, { recursive: true })
    const oldPlist = join(launchAgents, `${LEGACY_UPLOAD_SERVICE_LABEL}.plist`)
    writeFileSync(oldPlist, 'legacy worker plist')
    let loaded = true
    const calls = []
    const options = { home: f.home, uid: 501, platform: 'darwin', sleep: () => {},
      exec: (_binary, args) => {
        calls.push(args)
        if (args[0] === 'print') { if (loaded) return 'legacy loaded'; throw Object.assign(new Error('not loaded'), { status: 3 }) }
        if (args[0] === 'bootout') loaded = false
      } }
    expect(retireLegacyUploadWorker(options)).toEqual({ retired: true, bootedOut: true, plistDisabled: true })
    expect(existsSync(oldPlist)).toBe(false)
    expect(readFileSync(`${oldPlist}.disabled`, 'utf8')).toBe('legacy worker plist')
    expect(calls.filter((args) => args[0] === 'bootout')).toHaveLength(1)
    expect(retireLegacyUploadWorker(options)).toEqual({ retired: false, bootedOut: false, plistDisabled: false })
  })

  it('retires legacy only after the new running pid has acknowledged the one queue subscription', () => {
    const f = fixture()
    const oldDirectory = join(f.home, 'Library/LaunchAgents')
    mkdirSync(oldDirectory, { recursive: true })
    const oldPlist = join(oldDirectory, `${LEGACY_UPLOAD_SERVICE_LABEL}.plist`)
    writeFileSync(oldPlist, 'old upload worker')
    const calls = []
    let newLoaded = false, oldLoaded = true, logReads = 0
    let now = Date.parse('2026-10-19T10:00:00.000Z')
    const operations = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid,
      platform: 'darwin', pythonPath: process.execPath, npmCliPath: process.execPath,
      env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath },
      clock: () => now,
      sleep: () => { now += 1 },
      readQueueLog: () => {
        calls.push(['read-queue-log'])
        logReads += 1
        if (logReads === 1) throw Object.assign(new Error('log not created yet'), { code: 'ENOENT' })
        return JSON.stringify({ at: new Date(now).toISOString(), code: 'education_event_queue_listening',
          source: 'educationEvents', subscriptionCount: 1, processId: logReads === 2 ? 1234 : 4242 })
      },
      exec: (_binary, args) => {
        calls.push(args)
        if (args[0] === 'print') {
          if (args[1].endsWith(LEGACY_UPLOAD_SERVICE_LABEL)) { if (oldLoaded) return 'loaded'; throw Object.assign(new Error('not loaded'), { status: 3 }) }
          if (newLoaded) return 'state = running\npid = 4242'
          throw Object.assign(new Error('not loaded'), { status: 3 })
        }
        if (args[0] === 'bootstrap') newLoaded = true
        if (args[0] === 'bootout' && args[1].endsWith(LEGACY_UPLOAD_SERVICE_LABEL)) oldLoaded = false
      } })
    const result = operations.install({ apply: true })
    expect(result.legacyUploadWorker).toEqual({ retired: true, bootedOut: true, plistDisabled: true })
    expect(logReads).toBe(3)
    expect(existsSync(`${oldPlist}.disabled`)).toBe(true)
    expect(calls.findIndex((args) => args[0] === 'read-queue-log'))
      .toBeLessThan(calls.findIndex((args) => args[0] === 'bootout' && args[1].endsWith(LEGACY_UPLOAD_SERVICE_LABEL)))
  })

  it('keeps the old upload agent intact when queue readiness times out', () => {
    const f = fixture()
    const oldDirectory = join(f.home, 'Library/LaunchAgents')
    mkdirSync(oldDirectory, { recursive: true })
    const oldPlist = join(oldDirectory, `${LEGACY_UPLOAD_SERVICE_LABEL}.plist`)
    writeFileSync(oldPlist, 'old upload worker')
    let now = 0, newLoaded = false, oldLoaded = true
    const bootouts = []
    const operations = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid,
      platform: 'darwin', pythonPath: process.execPath, npmCliPath: process.execPath,
      env: { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', GOOGLE_APPLICATION_CREDENTIALS: f.adcPath },
      clock: () => { now += 5_000; return now }, sleep: () => {}, readQueueLog: () => '',
      exec: (_binary, args) => {
        if (args[0] === 'print') {
          if (args[1].endsWith(LEGACY_UPLOAD_SERVICE_LABEL)) { if (oldLoaded) return 'loaded'; throw Object.assign(new Error('not loaded'), { status: 3 }) }
          if (newLoaded) return 'state = running\npid = 4242'
          throw Object.assign(new Error('not loaded'), { status: 3 })
        }
        if (args[0] === 'bootstrap') newLoaded = true
        if (args[0] === 'bootout') {
          bootouts.push(args[1])
          if (args[1].endsWith('com.petr.education.telegram-worker')) newLoaded = false
        }
      } })
    expect(() => operations.install({ apply: true })).toThrow('education_event_queue_readiness_timeout')
    expect(bootouts).toEqual([`gui/${statSync(f.adcPath).uid}/com.petr.education.telegram-worker`])
    expect(existsSync(oldPlist)).toBe(true)
    expect(oldLoaded).toBe(true)
  })
})

it('rejects missing dependencies while finding the static relative-import closure', () => {
  const f = fixture()
  expect(dependencyClosure(f.root).sort()).toEqual(['scripts/lib.mjs', 'scripts/telegram-bot.mjs'])
  writeFileSync(join(f.root, 'scripts/telegram-bot.mjs'), "import './absent.mjs'\n")
  expect(() => dependencyClosure(f.root)).toThrow('runtime_dependency_missing')
})
