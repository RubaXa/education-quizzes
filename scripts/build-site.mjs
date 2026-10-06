import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildFingerprint } from './build-inputs.mjs'

const marker = resolve('.local/dist-build-inputs.sha256')
const fingerprint = buildFingerprint()

if (existsSync(resolve('dist/index.html'))
  && existsSync(marker)
  && readFileSync(marker, 'utf8').trim() === fingerprint) {
  console.log('Исходники сайта не менялись. Сборка не нужна.')
  process.exit(0)
}

execFileSync('npm', ['run', 'typecheck'], { stdio: 'inherit' })
execFileSync('npm', ['run', 'bundle'], { stdio: 'inherit' })
mkdirSync(resolve('.local'), { recursive: true })
writeFileSync(marker, `${fingerprint}\n`)
