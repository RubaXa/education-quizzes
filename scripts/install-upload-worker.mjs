import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

const root = resolve('.')
const local = resolve(root, '.local')
const adc = resolve(local, 'adc.json')
const token = resolve(local, 'yandex-disk-token')
if (!existsSync(adc) || !existsSync(token)) throw new Error('Сначала подключите Firebase ADC и Яндекс.Диск в .local/.')
const label = 'com.petr.education.upload-worker'
const agentDir = resolve(homedir(), 'Library/LaunchAgents')
const runtime = resolve(homedir(), 'Library/Application Support/PETR/upload-worker')
const plist = resolve(agentDir, `${label}.plist`)
const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
mkdirSync(resolve(runtime, 'scripts'), { recursive: true })
mkdirSync(resolve(runtime, 'storage'), { recursive: true })
mkdirSync(resolve(runtime, '.local'), { recursive: true, mode: 0o700 })
const workerFiles = ['scripts/direct-upload-worker.mjs', 'storage/direct-upload.mjs',
  'storage/family-book-upload.mjs', 'storage/family-book-projection.mjs', 'storage/textbook-catalog.mjs',
  'storage/yandex-disk.mjs', 'storage/submission-storage.mjs']
for (const file of workerFiles) {
  copyFileSync(resolve(root, file), resolve(runtime, file))
}
// @see ../docs/modules/synchronization/education-pipeline.md#sync-inbox
// Verify the copied module graph before replacing the live LaunchAgent.
for (const file of workerFiles) {
  const source = readFileSync(resolve(runtime, file), 'utf8')
  for (const [, dependency] of source.matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    if (!existsSync(resolve(dirname(resolve(runtime, file)), dependency))) {
      throw new Error(`Приёмник не обновлён: отсутствует зависимость ${dependency} для ${file}.`)
    }
  }
}
copyFileSync(adc, resolve(runtime, '.local/adc.json'))
copyFileSync(token, resolve(runtime, '.local/yandex-disk-token'))
chmodSync(resolve(runtime, '.local/adc.json'), 0o600)
chmodSync(resolve(runtime, '.local/yandex-disk-token'), 0o600)
writeFileSync(resolve(runtime, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'firebase-admin': '14.5.0' } }, null, 2))
if (!existsSync(resolve(runtime, 'node_modules/firebase-admin/package.json')) || !existsSync(resolve(runtime, 'node_modules/google-gax/package.json'))) {
  rmSync(resolve(runtime, 'node_modules'), { recursive: true, force: true })
  rmSync(resolve(runtime, 'package-lock.json'), { force: true })
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], { cwd: runtime, stdio: 'inherit' })
}
mkdirSync(agentDir, { recursive: true })
writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(resolve(runtime, 'scripts/direct-upload-worker.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(runtime)}</string>
<key>EnvironmentVariables</key><dict><key>GOOGLE_APPLICATION_CREDENTIALS</key><string>${xml(resolve(runtime, '.local/adc.json'))}</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(resolve(runtime, '.local/upload-worker.log'))}</string>
<key>StandardErrorPath</key><string>${xml(resolve(runtime, '.local/upload-worker-error.log'))}</string>
</dict></plist>
`, { mode: 0o600 })
const domain = `gui/${process.getuid()}`
try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }) } catch { /* First installation. */ }
for (let attempt = 0; attempt < 3; attempt += 1) {
  try { execFileSync('launchctl', ['bootstrap', domain, plist], { stdio: 'pipe' }); break }
  catch (error) {
    if (attempt === 2) throw error
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000 * (attempt + 1)))
  }
}
console.log(`Установлен процесс ${label}; при включении Mac он восстановит очередь.`)
