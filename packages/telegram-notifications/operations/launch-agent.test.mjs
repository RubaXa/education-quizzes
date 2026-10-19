import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createLaunchAgentOperations, dependencyClosure, makePlist, PERMANENT_WORKER_ARGUMENTS } from './launch-agent.mjs'
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
  writeFileSync(join(root, '.firebaserc'), JSON.stringify({ projects: { default: 'education-9d7c6' } }))
  const adcPath = join(root, '.local/adc.json')
  writeFileSync(adcPath, '{}', { mode: 0o600 })
  writeFileSync(join(root, '.local/family-access.json'), '{}', { mode: 0o600 })
  writeFileSync(join(root, '.local/diary/secret.json'), '{}', { mode: 0o600 })
  return { base, root, home, adcPath }
}

describe('launch agent release operations', () => {
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

  it('copies the complete local import closure and writes a private token outside the release', () => {
    const f = fixture()
    const secret = '123456:abcdefghijklmnopqrstuvwx'
    const calls = []
    const operations = createLaunchAgentOperations({ root: f.root, home: f.home, uid: statSync(f.adcPath).uid, platform: 'darwin',
      nodePath: process.execPath, npmCliPath: process.execPath, pythonPath: process.execPath,
      env: { AGI_EDU_BOT: secret, GOOGLE_APPLICATION_CREDENTIALS: f.adcPath,
        EDUCATION_SYNC_CODEX_PATH: process.execPath, EDUCATION_SYNC_THREAD_ID: '01a150dc-e067-7cc2-b08f-f573bf83e6e3',
        EDUCATION_SYNC_PROJECT_ROOT: f.root },
      exec: (...args) => calls.push(args) })
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
    expect(plist).toContain(process.execPath)
    expect(calls.map((call) => call[1][0])).toEqual([process.execPath, '--input-type=module', 'bootstrap'])
    expect(calls[0][1]).toContain('--ignore-scripts')
    expect(calls[1][1][2]).toContain('await import(')
    expect(parseBotArguments(PERMANENT_WORKER_ARGUMENTS)).toEqual({ command: 'worker', workerFlags: {
      enableDelivery: true, enableFirestoreSource: true, enableMeshSource: true,
    } })
    expect(plist).toContain('<key>ExitTimeOut</key><integer>35</integer>')
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
      sleep: () => { waits++ },
      exec: (_binary, args) => {
        if (args[0] === 'print') {
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
})

it('rejects missing dependencies while finding the static relative-import closure', () => {
  const f = fixture()
  expect(dependencyClosure(f.root).sort()).toEqual(['scripts/lib.mjs', 'scripts/telegram-bot.mjs'])
  writeFileSync(join(f.root, 'scripts/telegram-bot.mjs'), "import './absent.mjs'\n")
  expect(() => dependencyClosure(f.root)).toThrow('runtime_dependency_missing')
})
