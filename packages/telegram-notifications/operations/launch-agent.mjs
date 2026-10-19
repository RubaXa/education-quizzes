/** @see ../../../docs/services/telegram-bot/operations.md */
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolvePythonExecutable } from './process-lock.mjs'

export const SERVICE_LABEL = 'com.petr.education.telegram-worker'
const ENTRY = 'scripts/telegram-bot.mjs'
export const PERMANENT_WORKER_ARGUMENTS = Object.freeze(['worker', '--enable-firestore-source', '--enable-mesh-source', '--enable-delivery'])

/** Build a private, content-addressed LaunchAgent release. No secret enters the plist or argv. */
export function createLaunchAgentOperations({ root = process.cwd(), home = homedir(), uid = process.getuid?.(),
  env = process.env, fs = defaultFs, exec = execFileSync, sleep = sleepSync,
  nodePath = process.execPath, npmCliPath = null, pythonPath = null, platform = process.platform,
  teardownTimeoutMs = 35_000, bootstrapRetryMs = 8_000 } = {}) {
  const absoluteRoot = resolve(root)
  const support = resolve(home, 'Library/Application Support/PETR/telegram-worker')
  const agentDirectory = resolve(home, 'Library/LaunchAgents')
  const plistPath = resolve(agentDirectory, `${SERVICE_LABEL}.plist`)
  const domain = Number.isInteger(uid) ? `gui/${uid}` : null
  const tokenDirectory = resolve(support, 'secrets')
  const logDirectory = resolve(support, 'logs')

  function config() {
    if (platform !== 'darwin' || !domain) throw safeError('launchagent_macos_required')
    const projectId = env.TELEGRAM_FIRESTORE_PROJECT_ID || readFirebaseProject(absoluteRoot, fs)
    if (!validProject(projectId)) throw safeError('firebase_project_unavailable')
    const token = env.AGI_EDU_BOT
    if (typeof token !== 'string' || !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw safeError('bot_token_unavailable')
    const adcPath = env.GOOGLE_APPLICATION_CREDENTIALS || resolve(absoluteRoot, '.local/adc.json')
    if (!fs.existsSync(adcPath)) throw safeError('application_credentials_unavailable')
    const adcInfo = fs.statSync(adcPath)
    if (!adcInfo.isFile() || (adcInfo.mode & 0o077) !== 0 || (Number.isInteger(uid) && adcInfo.uid !== uid)) {
      throw safeError('application_credentials_unavailable')
    }
    try { fs.accessSync(adcPath, fs.constants?.R_OK ?? constants.R_OK) } catch { throw safeError('application_credentials_unavailable') }
    const meshDirectory = resolve(absoluteRoot, env.TELEGRAM_MESH_CONNECTION_DIRECTORY || '.local/mesh-connections')
    const familyAccessPath = resolve(absoluteRoot, env.TELEGRAM_FAMILY_ACCESS_PATH || '.local/family-access.json')
    const legacyCredentialsPath = resolve(absoluteRoot, env.TELEGRAM_LEGACY_CREDENTIALS_PATH || '.local/diary/secret.json')
    const educationSync = resolveEducationSync(env, fs)
    let python
    try { python = pythonPath ?? resolvePythonExecutable(env, fs) } catch { throw safeError('python_runtime_unavailable') }
    if (!python || !fs.existsSync(python) || !fs.statSync(python).isFile() || (fs.statSync(python).mode & 0o111) === 0) {
      throw safeError('python_runtime_unavailable')
    }
    const npm = npmCliPath ?? resolve(dirname(nodePath), '../lib/node_modules/npm/bin/npm-cli.js')
    if (!fs.existsSync(npm) || !fs.statSync(npm).isFile()) throw safeError('npm_runtime_unavailable')
    const canonicalAvailable = fs.existsSync(meshDirectory)
    const legacyAvailable = fs.existsSync(familyAccessPath) && fs.existsSync(legacyCredentialsPath)
    if (!canonicalAvailable && !legacyAvailable) throw safeError('mesh_credentials_path_unavailable')
    try {
      fs.accessSync(canonicalAvailable ? meshDirectory : familyAccessPath, fs.constants?.R_OK ?? constants.R_OK)
      if (!canonicalAvailable) fs.accessSync(legacyCredentialsPath, fs.constants?.R_OK ?? constants.R_OK)
    } catch { throw safeError('mesh_credentials_path_unavailable') }
    return { projectId, token, adcPath: resolve(adcPath), meshDirectory, familyAccessPath, legacyCredentialsPath,
      pythonPath: fs.realpathSync ? fs.realpathSync(python) : realpathSync(python), npmCliPath: resolve(npm), educationSync }
  }

  function plan() {
    const values = config()
    const closure = dependencyClosure(absoluteRoot, ENTRY, fs)
    const fingerprint = createHash('sha256')
    for (const file of [...closure, 'package.json', 'package-lock.json'].sort()) {
      fingerprint.update(file).update('\0').update(fs.readFileSync(resolve(absoluteRoot, file)).toString()).update('\0')
    }
    const releaseHash = fingerprint.digest('hex').slice(0, 24)
    const tokenPath = resolve(tokenDirectory, `bot-token-${randomUUID()}`)
    return Object.freeze({ label: SERVICE_LABEL, releaseHash, releasePath: resolve(support, 'releases', releaseHash),
      plistPath, projectId: values.projectId, meshDirectory: values.meshDirectory, adcPath: values.adcPath,
      tokenPath, logDirectory, fileCount: closure.length, launchDomain: domain })
  }

  function install({ apply = false } = {}) {
    const values = config()
    const release = plan()
    if (!apply) return { applied: false, ...release }
    const closure = [...dependencyClosure(absoluteRoot, ENTRY, fs), 'package.json', 'package-lock.json']
    const releaseExists = fs.existsSync(release.releasePath)
    if (releaseExists) {
      for (const source of closure) {
        const target = resolve(release.releasePath, source)
        if (!fs.existsSync(target) || !fs.readFileSync(target).equals(fs.readFileSync(resolve(absoluteRoot, source)))) {
          throw safeError('release_integrity_failed')
        }
      }
    } else {
      fs.mkdirSync(release.releasePath, { recursive: true, mode: 0o700 })
      for (const source of closure) {
        const target = resolve(release.releasePath, source)
        fs.mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
        fs.copyFileSync(resolve(absoluteRoot, source), target)
        fs.chmodSync(target, fs.statSync(target).mode & 0o111 ? 0o700 : 0o600)
      }
    }
    if (!fs.existsSync(resolve(release.releasePath, 'node_modules'))) {
      exec(nodePath, [values.npmCliPath, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund',
        '--registry=https://registry.npmjs.org'], { cwd: release.releasePath, stdio: 'pipe',
        env: Object.fromEntries(Object.entries(env).filter(([key]) => !['AGI_EDU_BOT', 'TELEGRAM_TOKEN_FILE'].includes(key))) })
    }
    exec(nodePath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(resolve(release.releasePath, ENTRY)).href)})`],
      { cwd: release.releasePath, stdio: 'pipe' })
    writePrivate(release.tokenPath, `${values.token}\n`, fs)
    fs.mkdirSync(logDirectory, { recursive: true, mode: 0o700 })
    const environment = {
      TELEGRAM_FIRESTORE_PROJECT_ID: values.projectId,
      TELEGRAM_TOKEN_FILE: release.tokenPath,
      GOOGLE_APPLICATION_CREDENTIALS: values.adcPath,
      TELEGRAM_MESH_CONNECTION_DIRECTORY: values.meshDirectory,
      TELEGRAM_FAMILY_ACCESS_PATH: values.familyAccessPath,
      TELEGRAM_LEGACY_CREDENTIALS_PATH: values.legacyCredentialsPath,
      TELEGRAM_LOG_DIRECTORY: logDirectory,
      TELEGRAM_LOCK_PYTHON: values.pythonPath,
    }
    if (values.educationSync) {
      environment.EDUCATION_SYNC_CODEX_PATH = values.educationSync.codexPath
      environment.EDUCATION_SYNC_THREAD_ID = values.educationSync.threadId
      environment.EDUCATION_SYNC_PROJECT_ROOT = values.educationSync.projectRoot
      if (values.educationSync.remote) environment.EDUCATION_SYNC_REMOTE = values.educationSync.remote
    }
    for (const key of ['TELEGRAM_STARTUP_OPERATION_TIMEOUT_MS', 'TELEGRAM_SOURCE_OPERATION_TIMEOUT_MS',
      'TELEGRAM_DELIVERY_OPERATION_TIMEOUT_MS', 'TELEGRAM_EDUCATION_SYNC_OPERATION_TIMEOUT_MS']) {
      if (env[key] !== undefined) environment[key] = String(env[key])
    }
    const plist = makePlist({ label: SERVICE_LABEL, nodePath, scriptPath: resolve(release.releasePath, ENTRY),
      args: PERMANENT_WORKER_ARGUMENTS, workingDirectory: release.releasePath, environment, logPath: '/dev/null' })
    fs.mkdirSync(agentDirectory, { recursive: true, mode: 0o700 })
    const nextPlist = `${plistPath}.next`
    const previousPlist = fs.existsSync(plistPath) ? fs.readFileSync(plistPath) : null
    const previousLoaded = Boolean(previousPlist && status().loaded)
    fs.writeFileSync(nextPlist, plist, { mode: 0o600 })
    fs.renameSync(nextPlist, plistPath)
    try {
      if (previousLoaded) {
        try { exec('launchctl', ['bootout', `${domain}/${SERVICE_LABEL}`], { stdio: 'ignore' }) }
        catch {
          if (status().loaded) throw safeError('launchagent_stop_failed')
        }
        waitUntilUnloaded()
      }
      bootstrapWithRetry(plistPath)
    }
    catch {
      if (previousPlist) {
        fs.writeFileSync(nextPlist, previousPlist, { mode: 0o600 })
        fs.renameSync(nextPlist, plistPath)
        if (previousLoaded) {
          try {
            waitUntilUnloaded()
            bootstrapWithRetry(plistPath)
          } catch { /* Prior plist is restored; status exposes whether launchd loaded it. */ }
        }
      } else fs.rmSync(plistPath, { force: true })
      throw safeError('launchagent_bootstrap_failed')
    }
    return { applied: true, ...release, state: 'bootstrapped' }
  }

  function status() {
    assertHost()
    const present = fs.existsSync(plistPath)
    if (!present) return { installed: false, running: false, pid: null }
    let output = ''
    try { output = String(exec('launchctl', ['print', `${domain}/${SERVICE_LABEL}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) }
    catch { return { installed: true, loaded: false, running: false, pid: null } }
    const pid = Number(output.match(/\bpid\s*=\s*(\d+)/)?.[1]) || null
    const state = output.match(/\bstate\s*=\s*(running|waiting|exited|spawn scheduled|throttled)/)?.[1] ?? 'unknown'
    const lastExitCode = Number(output.match(/\blast exit code\s*=\s*(-?\d+)/i)?.[1])
    const runs = Number(output.match(/\bruns\s*=\s*(\d+)/)?.[1])
    return { installed: true, loaded: true, running: state === 'running' && pid !== null, state, pid,
      ...(Number.isSafeInteger(lastExitCode) ? { lastExitCode } : {}), ...(Number.isSafeInteger(runs) ? { runs } : {}) }
  }

  function stop() {
    assertHost()
    if (!fs.existsSync(plistPath)) return { stopped: false, installed: false }
    if (!status().loaded) return { stopped: false, installed: true, state: 'not_running' }
    try { exec('launchctl', ['bootout', `${domain}/${SERVICE_LABEL}`], { stdio: 'pipe' }) }
    catch { throw safeError('launchagent_stop_failed') }
    return { stopped: true, installed: true }
  }

  function uninstall({ apply = false } = {}) {
    if (apply) assertHost()
    if (!apply) return { applied: false, plistPath, releaseRetained: true, secretRetained: true }
    stop()
    if (fs.existsSync(plistPath)) fs.rmSync(plistPath)
    return { applied: true, uninstalled: true, releaseRetained: true, secretRetained: true }
  }

  return Object.freeze({ plan, install, status, stop, uninstall, paths: Object.freeze({ plistPath, support, tokenDirectory }) })

  function waitUntilUnloaded() {
    const deadline = Date.now() + teardownTimeoutMs
    while (status().loaded) {
      if (Date.now() >= deadline) throw safeError('launchagent_stop_timeout')
      const remaining = Math.max(1, Math.min(250, deadline - Date.now()))
      // Tests inject a no-delay clock; production always waits on launchd's state change.
      sleep(remaining)
    }
  }

  function bootstrapWithRetry(path) {
    const deadline = Date.now() + bootstrapRetryMs
    let delay = 100
    while (true) {
      try { exec('launchctl', ['bootstrap', domain, path], { stdio: 'pipe' }); return }
      catch (error) {
        if (!isTransientBootstrapBusy(error) || Date.now() >= deadline) throw error
        const remaining = Math.max(1, Math.min(delay, deadline - Date.now()))
        sleep(remaining)
        delay = Math.min(1_000, delay * 2)
      }
    }
  }

  function assertHost() {
    if (platform !== 'darwin' || !domain) throw safeError('launchagent_macos_required')
  }
}

function resolveEducationSync(env, fs) {
  const codexPath = env.EDUCATION_SYNC_CODEX_PATH
  const threadId = env.EDUCATION_SYNC_THREAD_ID
  if (!codexPath && !threadId) return null
  if (typeof codexPath !== 'string' || !codexPath.startsWith('/') || !fs.existsSync(codexPath)) throw safeError('education_sync_config_unavailable')
  const executable = fs.statSync(codexPath)
  if (!executable.isFile() || (executable.mode & 0o111) === 0) throw safeError('education_sync_config_unavailable')
  if (typeof threadId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(threadId)) throw safeError('education_sync_config_unavailable')
  const projectRoot = env.EDUCATION_SYNC_PROJECT_ROOT
  if (typeof projectRoot !== 'string' || !projectRoot.startsWith('/') || !fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) throw safeError('education_sync_config_unavailable')
  const remote = env.EDUCATION_SYNC_REMOTE || null
  if (remote !== null && !remote.startsWith('unix://')) throw safeError('education_sync_config_unavailable')
  return { codexPath, threadId, projectRoot, remote }
}

export function dependencyClosure(root, entry = ENTRY, fs = defaultFs) {
  const found = new Set()
  const pending = [entry]
  while (pending.length) {
    const relativeFile = pending.pop()
    if (found.has(relativeFile)) continue
    const absoluteFile = resolve(root, relativeFile)
    if (!absoluteFile.startsWith(`${resolve(root)}${sep}`) || !fs.existsSync(absoluteFile)) throw safeError('runtime_dependency_missing')
    found.add(relativeFile)
    const source = fs.readFileSync(absoluteFile, 'utf8')
    for (const [, specifier] of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = resolve(dirname(absoluteFile), specifier)
      let resolvedTarget = target
      if (!fs.existsSync(resolvedTarget)) resolvedTarget = `${target}.mjs`
      if (fs.existsSync(resolvedTarget)) pending.push(relative(root, resolvedTarget))
      else throw safeError('runtime_dependency_missing')
    }
  }
  return [...found].sort()
}

export function makePlist({ label, nodePath, scriptPath, args, workingDirectory, environment, logPath }) {
  const xml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
  const string = (value) => `<string>${xml(value)}</string>`
  const env = Object.entries(environment).map(([key, value]) => `<key>${xml(key)}</key>${string(value)}`).join('')
  const argv = [nodePath, scriptPath, ...args].map(string).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key>${string(label)}\n<key>ProgramArguments</key><array>${argv}</array>\n<key>WorkingDirectory</key>${string(workingDirectory)}\n<key>EnvironmentVariables</key><dict>${env}</dict>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>ExitTimeOut</key><integer>35</integer>\n<key>StandardOutPath</key>${string(logPath)}\n<key>StandardErrorPath</key>${string(logPath)}\n</dict></plist>\n`
}

function writePrivate(path, value, fs) {
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  fs.writeFileSync(temp, value, { mode: 0o600, flag: 'wx' })
  fs.chmodSync(temp, 0o600)
  fs.renameSync(temp, path)
  fs.chmodSync(path, 0o600)
}
function readFirebaseProject(root, fs) {
  try { return JSON.parse(fs.readFileSync(resolve(root, '.firebaserc'), 'utf8'))?.projects?.default ?? null }
  catch { return null }
}
function validProject(value) { return typeof value === 'string' && /^[a-z][a-z0-9-]{4,62}$/.test(value) }
function isTransientBootstrapBusy(error) {
  if (['EBUSY', 'EAGAIN'].includes(error?.code) || error?.status === 5) return true
  const detail = Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : String(error?.stderr ?? '')
  return /resource busy|operation in progress|service.{0,40}already (?:loaded|bootstrapped)/i.test(detail)
}
function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}
function safeError(code) { const error = new Error(code); error.safeCode = code; return error }
const defaultFs = { existsSync, mkdirSync, copyFileSync, chmodSync, statSync, readFileSync, writeFileSync, renameSync, rmSync,
  readdirSync, accessSync, realpathSync, constants }
