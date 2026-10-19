import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTelegramConfig } from './config.mjs'
import { loadConfig } from './config.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Telegram secret configuration', () => {
  it('sets bounded defaults and validates operation deadlines', () => {
    const env = { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', TELEGRAM_FIRESTORE_PROJECT_ID: 'education-prod' }
    expect(loadConfig(env)).toMatchObject({ sourceOperationTimeoutMs: 600_000, deliveryOperationTimeoutMs: 600_000,
      educationSyncOperationTimeoutMs: 60_000 })
    expect(loadConfig({ ...env, TELEGRAM_SOURCE_OPERATION_TIMEOUT_MS: '180000' }).sourceOperationTimeoutMs).toBe(180_000)
    expect(() => loadConfig({ ...env, TELEGRAM_DELIVERY_OPERATION_TIMEOUT_MS: '1' })).toThrow('delivery_operation_timeout_invalid')
    expect(() => loadConfig({ ...env, TELEGRAM_SOURCE_OPERATION_TIMEOUT_MS: 'forever' })).toThrow('source_operation_timeout_invalid')
    expect(() => loadConfig({ ...env, TELEGRAM_EDUCATION_SYNC_OPERATION_TIMEOUT_MS: '0' })).toThrow('education_sync_operation_timeout_invalid')
  })

  it('keeps EducationSync dispatch disabled without a complete explicit route', () => {
    const env = { AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwx', TELEGRAM_FIRESTORE_PROJECT_ID: 'education-prod' }
    expect(loadConfig(env).educationSync).toBeNull()
    expect(() => loadConfig({ ...env, EDUCATION_SYNC_CODEX_PATH: '/Applications/ChatGPT.app/codex' })).toThrow('education_sync_config_invalid')
    expect(loadConfig({ ...env, EDUCATION_SYNC_CODEX_PATH: '/Applications/ChatGPT.app/codex',
      EDUCATION_SYNC_THREAD_ID: '01a150dc-e067-7cc2-b08f-f573bf83e6e3', EDUCATION_SYNC_PROJECT_ROOT: '/Users/test/PETR' }).educationSync)
      .toMatchObject({ codexPath: '/Applications/ChatGPT.app/codex', threadId: '01a150dc-e067-7cc2-b08f-f573bf83e6e3', projectRoot: '/Users/test/PETR' })
  })

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
