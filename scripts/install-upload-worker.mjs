import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const root = resolve('.')
const local = resolve(root, '.local')
const adc = resolve(local, 'adc.json')
const token = resolve(local, 'yandex-disk-token')
if (!existsSync(adc) || !existsSync(token)) throw new Error('Сначала подключите Firebase ADC и Яндекс.Диск в .local/.')
const label = 'com.petr.education.upload-worker'
const agentDir = resolve(homedir(), 'Library/LaunchAgents')
const plist = resolve(agentDir, `${label}.plist`)
const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
mkdirSync(agentDir, { recursive: true })
writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(resolve(root, 'scripts/direct-upload-worker.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>GOOGLE_APPLICATION_CREDENTIALS</key><string>${xml(adc)}</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(resolve(local, 'upload-worker.log'))}</string>
<key>StandardErrorPath</key><string>${xml(resolve(local, 'upload-worker-error.log'))}</string>
</dict></plist>
`, { mode: 0o600 })
const domain = `gui/${process.getuid()}`
try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }) } catch { /* First installation. */ }
execFileSync('launchctl', ['bootstrap', domain, plist], { stdio: 'pipe' })
execFileSync('launchctl', ['kickstart', '-k', `${domain}/${label}`], { stdio: 'pipe' })
console.log(`Установлен процесс ${label}; при включении Mac он восстановит очередь.`)
