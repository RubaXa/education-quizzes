import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { inspectRoutePlan } from './route-plan.mjs'

describe('saved deterministic operator plan', () => {
  it('requires a complete scan, writes a private plan, and never treats that receipt as a fresh cycle', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'sync-plan-'))
    const id = '11111111-1111-4111-8111-111111111111'
    const directory = resolve(root, '.local/operator-runs')
    mkdirSync(directory, { recursive: true })
    const file = resolve(directory, `${id}.json`)
    const write = snapshot => writeFileSync(file, JSON.stringify({ operation: 'queue.scan', status: 'succeeded', stdout: JSON.stringify(snapshot) }))
    try {
      write({ inboxSnapshot: { complete: true } })
      expect(() => inspectRoutePlan(root, id)).toThrow('fresh discovery')
      write({ inboxSnapshot: { complete: false }, routePlan: { schemaVersion: 1, tasks: [], jobs: [] } })
      expect(() => inspectRoutePlan(root, id)).toThrow('complete route plan')
      write({ scannedAt: '2026-10-23T10:00:00Z', inboxSnapshot: { complete: true },
        routePlan: { schemaVersion: 1, tasks: [{ taskId: 'task', next: 'recover-source' }], jobs: [] } })
      const result = inspectRoutePlan(root, id)
      expect(result).toMatchObject({ tasks: 1, routes: { 'recover-source': 1 }, completionClaim: false, freshSourceCheckRequired: true })
      expect(statSync(result.planPath).mode & 0o077).toBe(0)
      expect(JSON.parse(readFileSync(result.planPath, 'utf8')).tasks[0].taskId).toBe('task')
      expect(() => inspectRoutePlan(root, '../../other')).toThrow('UUID')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
