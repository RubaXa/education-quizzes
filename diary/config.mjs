import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const allowedKeys = new Set(['SCHOOL_DIARY_PROVIDER', 'SCHOOL_DIARY_TIMEZONE', 'SCHOOL_DIARY_DATA_DIR'])

export function loadConfig() {
  const file = resolve('.env.local')
  const values = {}
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_]+)=(.*)\s*$/)
      if (match && allowedKeys.has(match[1])) values[match[1]] = match[2].trim()
    }
  }
  const provider = values.SCHOOL_DIARY_PROVIDER || 'mesh'
  if (provider !== 'mesh') throw new Error(`Поставщик ${provider} пока не поддерживается`)
  return {
    provider,
    timeZone: values.SCHOOL_DIARY_TIMEZONE || 'Europe/Moscow',
    dataDir: resolve(values.SCHOOL_DIARY_DATA_DIR || '.local/diary'),
  }
}
