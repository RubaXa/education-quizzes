import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export function ensureDataDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
}

export function readJson(dir, name) {
  const file = join(dir, name)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

export function writeJson(dir, name, value) {
  ensureDataDir(dir)
  const file = join(dir, name)
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  renameSync(temporary, file)
  chmodSync(file, 0o600)
}
