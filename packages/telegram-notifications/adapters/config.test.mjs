import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTelegramConfig } from './config.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Telegram secret configuration', () => {
  it('loads a private owner-only token file when the environment token is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'telegram-config-test-'))
    roots.push(root)
    const path = join(root, 'token')
    writeFileSync(path, '123456:abcdefghijklmnopqrstuvwx\n', { mode: 0o600 })
    expect(loadTelegramConfig({ TELEGRAM_TOKEN_FILE: path })).toEqual({ token: '123456:abcdefghijklmnopqrstuvwx' })
  })

  it('prefers an explicit environment token and rejects a group-readable token file', () => {
    const root = mkdtempSync(join(tmpdir(), 'telegram-config-test-'))
    roots.push(root)
    const path = join(root, 'token')
    writeFileSync(path, '123456:abcdefghijklmnopqrstuvwx\n', { mode: 0o644 })
    expect(loadTelegramConfig({ AGI_EDU_BOT: '654321:abcdefghijklmnopqrstuvwx', TELEGRAM_TOKEN_FILE: path }))
      .toEqual({ token: '654321:abcdefghijklmnopqrstuvwx' })
    expect(() => loadTelegramConfig({ TELEGRAM_TOKEN_FILE: path })).toThrow('bot_token_missing')
  })
})
