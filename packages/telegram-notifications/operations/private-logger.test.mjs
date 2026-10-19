import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrivateLogger, sanitizeOperationalLog } from './private-logger.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('private runtime logger', () => {
  it('keeps only bounded operational health facts and rejects arbitrary error or identity fields', () => {
    const scopeKey = 'a'.repeat(64)
    expect(sanitizeOperationalLog({ code: 'inventory_partial', source: 'firestore', failedFamilies: 2,
      scopeKey, errorCode: 'deadline-exceeded', reasonCode: 'source_snapshot_too_large',
      hasMeshIdentity: true, hasMeshAccount: false, processId: 321, rawError: 'private', error: 'PII', familyId: 'family-private' }))
      .toEqual({ code: 'inventory_partial', source: 'firestore', failedFamilies: 2, scopeKey,
        errorCode: 'deadline-exceeded', reasonCode: 'source_snapshot_too_large', hasMeshIdentity: true, hasMeshAccount: false, processId: 321 })
    expect(sanitizeOperationalLog({ source: 'secret', scopeKey: 'not-a-hash', errorCode: 'private-message',
      reasonCode: 'invented', failedFamilies: -1, familyId: 'private' })).toEqual({})
  })

  it('rotates bounded files and drops unapproved fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'telegram-log-test-'))
    roots.push(root)
    const path = join(root, 'logs/worker.jsonl')
    const logger = createPrivateLogger(path, { maxBytes: 1024, maxFiles: 2 })
    for (let index = 0; index < 30; index += 1) logger.info({ code: 'worker_tick', telegramUserId: 'private-user', detail: 'private detail' })
    const files = readdirSync(join(root, 'logs')).sort()
    expect(files).toEqual(['worker.jsonl', 'worker.jsonl.1'])
    const output = files.map((file) => readFileSync(join(root, 'logs', file), 'utf8')).join('')
    expect(output).toContain('worker_tick')
    expect(output).not.toContain('private-user')
    expect(output).not.toContain('private detail')
    for (const file of files) expect(statSync(join(root, 'logs', file)).mode & 0o077).toBe(0)
  })
})
