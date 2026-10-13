import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureHash, persistMeshCapture } from './artifact-capture.mjs'

const dirs = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
const snapshot = (fetchedAt = '2026-10-12T10:00:00Z') => ({ schemaVersion: 1, source: 'mesh', date: '2026-10-12',
  fetchedAt, complete: true, profile: { id: 1 }, schedule: [], marks: [], assignments: [] })

describe('закрытый исходный артефакт', () => {
  it('повторный сбор того же содержимого переиспользует один снимок, сохраняя наблюдения запусков', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'education-capture-'))
    dirs.push(runDir)
    const one = persistMeshCapture({ runDir, runId: '2026-10-12-11111111-1111-4111-8111-111111111111',
      familyId: 'family-a', childId: 'child-a', snapshot: snapshot() })
    const two = persistMeshCapture({ runDir, runId: '2026-10-12-22222222-2222-4222-8222-222222222222',
      familyId: 'family-a', childId: 'child-a', snapshot: snapshot('2026-10-12T11:00:00Z') })
    expect(one).toEqual(two)
    expect(readdirSync(join(runDir, 'private-captures/family-a/child-a/2026-10-12'))).toHaveLength(1)
  })
  it('не принимает неполный снимок и меняет хэш при изменении содержания', () => {
    expect(() => captureHash({ ...snapshot(), complete: false })).toThrow(/Неполный/)
    expect(captureHash(snapshot())).not.toBe(captureHash({ ...snapshot(), assignments: [{ id: 2 }] }))
  })
})
