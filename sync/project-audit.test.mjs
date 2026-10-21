import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { dateWindow } from './project-plan.mjs'
import { resolveProjectAuditSourcePath, runProjectPublicationAudit } from './project-audit.mjs'

const runId = '2026-11-02-12345678-1234-1234-1234-123456789abc'
const owner = { familyId: 'family-opaque-1', childId: 'child-opaque-1' }
const setup = () => {
  const root = mkdtempSync(resolve(tmpdir(), 'project-audit-'))
  const dates = dateWindow('2026-11-02')
  const sourceDir = resolve(root, 'project-sync/sources', owner.familyId, owner.childId, 'diary')
  const manifest = { runId, startedFor: '2026-11-02', jobs: [{ ...owner, sourceDir, checkedFrom: dates[0],
    checkedThrough: dates.at(-1), checkedDates: 42, changes: { assignments: 1 } }] }
  const deps = {
    runId, manifest,
    readSyncStatus: vi.fn(async () => ({ runId, phase: 'awaiting-review' })),
    resolveSourcePath: vi.fn((job) => job.sourceDir),
    readSnapshot: vi.fn(async (_dir, date) => ({ date, complete: true })),
    auditPublishedDays: vi.fn(async (_dir, gotDates, asOf, target) => ({ pending: [],
      expectedByDate: new Map(gotDates.map((date) => [date, { date, revision: 'v1' }])) })),
    writeReceipt: vi.fn(async () => {}),
    now: () => '2026-11-02T12:00:00.000Z',
  }
  return { root, dates, sourceDir, manifest, deps }
}

describe('read-only project publication audit', () => {
  it('audits the manifest frozen 42-date window and writes a separate verified receipt', async () => {
    const state = setup()
    try {
      const result = await runProjectPublicationAudit(state.deps)
      expect(result).toMatchObject({ runId, checkedFrom: state.dates[0], checkedThrough: state.dates.at(-1),
        checkedDates: 42, workflowPhaseChanged: false, readOnly: true, receiptReadOnly: true,
        status: 'publication-verified', publicationVerified: true, blockedCount: 0, pendingCount: 0 })
      expect(result.results).toEqual([{ ...owner, status: 'publication-verified', reason: null, pendingPublicationDates: [] }])
      expect(state.deps.readSnapshot).toHaveBeenCalledTimes(42)
      expect(state.deps.auditPublishedDays).toHaveBeenCalledWith(state.sourceDir, state.dates, state.manifest.startedFor, owner)
      expect(state.deps.writeReceipt).toHaveBeenCalledWith(result)
      expect(state.manifest.audit).toBeUndefined()
    } finally { rmSync(state.root, { recursive: true, force: true }) }
  })

  it('accepts a sparse expected calendar for a clean 42-snapshot window', async () => {
    const state = setup()
    try {
      state.deps.auditPublishedDays.mockResolvedValue({ pending: [], expectedByDate: new Map() })
      const result = await runProjectPublicationAudit(state.deps)
      expect(result.results[0].status).toBe('publication-verified')
      expect(state.deps.readSnapshot).toHaveBeenCalledTimes(42)
    } finally { rmSync(state.root, { recursive: true, force: true }) }
  })

  it('keeps publication pending before and after source changes without completing workflow', async () => {
    const state = setup()
    try {
      state.deps.auditPublishedDays.mockImplementation(async (_dir, dates) => ({ pending: [{ date: dates[7], reasons: ['source-revision-differs'] }],
        expectedByDate: new Map(dates.map((date) => [date, { date }])) }))
      const result = await runProjectPublicationAudit(state.deps)
      expect(result.results[0]).toMatchObject({ status: 'pending', pendingPublicationDates: [{ date: state.dates[7], reasons: ['source-revision-differs'] }] })
      expect(result.workflowPhaseChanged).toBe(false)
      expect(state.manifest.jobs[0]).not.toHaveProperty('phase')
    } finally { rmSync(state.root, { recursive: true, force: true }) }
  })

  it('records audit failures as blocked rather than verified with zero pending dates', async () => {
    const state = setup()
    try {
      state.deps.auditPublishedDays.mockRejectedValue(new Error('private diagnostic'))
      const result = await runProjectPublicationAudit(state.deps)
      expect(result.results[0]).toMatchObject({ status: 'blocked', reason: 'publication-audit-failed', pendingPublicationDates: null })
      expect(result.pendingPublicationDates).toEqual([])
      expect(JSON.stringify(result)).not.toContain('private diagnostic')
    } finally { rmSync(state.root, { recursive: true, force: true }) }
  })

  it.each([
    ['wrong run ID', (state) => { state.manifest.runId = '2026-11-02-87654321-1234-1234-1234-123456789abc' }],
    ['wrong window', (state) => { state.manifest.jobs[0].checkedThrough = '2026-11-01' }],
    ['wrong owner path', (state) => { state.deps.resolveSourcePath.mockReturnValue(resolve(state.root, 'another-child/diary')) }],
  ])('rejects %s before publication reads or receipt writes', async (_label, change) => {
    const state = setup()
    try {
      change(state)
      await expect(runProjectPublicationAudit(state.deps)).rejects.toThrow()
      expect(state.deps.auditPublishedDays).not.toHaveBeenCalled()
      expect(state.deps.writeReceipt).not.toHaveBeenCalled()
    } finally { rmSync(state.root, { recursive: true, force: true }) }
  })

  it('rejects an overwritten current status or any incomplete snapshot', async () => {
    const state = setup()
    try {
      state.deps.readSyncStatus.mockResolvedValueOnce({ runId: 'newer-run' })
      await expect(runProjectPublicationAudit(state.deps)).rejects.toThrow(/другому запуску/)
      expect(state.deps.readSnapshot).not.toHaveBeenCalled()
      state.deps.readSyncStatus.mockResolvedValue({ runId })
      state.deps.readSnapshot.mockImplementationOnce(async (_dir, date) => ({ date, complete: false }))
      await expect(runProjectPublicationAudit(state.deps)).rejects.toThrow(/полного снимка/)
      expect(state.deps.auditPublishedDays).not.toHaveBeenCalled()
      expect(state.deps.writeReceipt).not.toHaveBeenCalled()
    } finally { rmSync(state.root, { recursive: true, force: true }) }
  })

  it('rechecks the current run after reading publication before writing a verified receipt', async () => {
    const state = setup()
    try {
      let reads = 0
      state.deps.readSyncStatus.mockImplementation(async () => ({ runId: ++reads === 1 ? runId : 'concurrent-run' }))
      await expect(runProjectPublicationAudit(state.deps)).rejects.toThrow(/сменился во время аудита/)
      expect(state.deps.readSyncStatus).toHaveBeenCalledTimes(2)
      expect(state.deps.auditPublishedDays).toHaveBeenCalledTimes(1)
      expect(state.deps.writeReceipt).not.toHaveBeenCalled()
    } finally { rmSync(state.root, { recursive: true, force: true }) }
  })

  it('does not expose any write, collection, inventory, job, or phase mutation capability', async () => {
    const state = setup()
    try {
      const result = await runProjectPublicationAudit(state.deps)
      expect(Object.keys(state.deps).sort()).toEqual(['auditPublishedDays', 'manifest', 'now', 'readSnapshot', 'readSyncStatus', 'resolveSourcePath', 'runId', 'writeReceipt'].sort())
      expect(result.workflowPhaseChanged).toBe(false)
    } finally { rmSync(state.root, { recursive: true, force: true }) }
  })

  it('allows only canonical per-owner paths and explicitly owned legacy diaries', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'project-audit-path-'))
    try {
      const localDir = resolve(root, '.local')
      const runDir = resolve(localDir, 'project-sync')
      const ownerDir = resolve(runDir, 'sources', owner.familyId, owner.childId)
      const canonical = { ...owner, sourceDir: resolve(ownerDir, 'diary') }
      mkdirSync(canonical.sourceDir, { recursive: true })
      writeFileSync(resolve(ownerDir, 'context.json'), JSON.stringify(owner))
      expect(resolveProjectAuditSourcePath(canonical, { localDir, runDir })).toBe(canonical.sourceDir)
      const legacy = { ...owner, sourceDir: resolve(localDir, 'diary') }
      mkdirSync(legacy.sourceDir, { recursive: true })
      expect(() => resolveProjectAuditSourcePath(legacy, { localDir, runDir,
        legacyOwner: { familyId: 'other', childId: owner.childId } })).toThrow(/не принадлежит владельцу/)
      expect(resolveProjectAuditSourcePath(legacy, { localDir, runDir, legacyOwner: owner })).toBe(legacy.sourceDir)

      writeFileSync(resolve(ownerDir, 'context.json'), JSON.stringify({ familyId: 'other', childId: owner.childId }))
      expect(() => resolveProjectAuditSourcePath(canonical, { localDir, runDir })).toThrow(/не принадлежит владельцу/)
      writeFileSync(resolve(ownerDir, 'context.json'), JSON.stringify(owner))
      const outside = resolve(root, 'outside')
      mkdirSync(outside)
      rmSync(canonical.sourceDir, { recursive: true })
      symlinkSync(outside, canonical.sourceDir)
      expect(() => resolveProjectAuditSourcePath(canonical, { localDir, runDir })).toThrow(/не принадлежит владельцу/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
