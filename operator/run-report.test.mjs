/** @see ../docs/modules/synchronization/execution-artifact.md#run-report */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildRunReport, finishDispatchReport, saveRunReport, RUN_PHASES } from './run-report.mjs'
const phase = (id, status = 'succeeded') => ({ id, status,
  started: status === 'not-run' ? false : true, reason: 'Проверено по квитанции.', evidence: ['private-receipt'] })
describe('finished run and independent phase outcomes', () => {
  it('finishes with a partial outcome when Mesh fails while work and both roles succeed', () => {
    const report = buildRunReport({ runId: 'run-1', scope: 'full', phases: RUN_PHASES.map(id =>
      id === 'mesh' ? { ...phase(id, 'blocked'), reason: 'HTTP 500, 7 / 42 дат.' } : phase(id)) })
    expect(report).toMatchObject({ lifecycle: 'finished', outcome: 'partial', sourceCycleComplete: false })
    expect(report.phases.find(p => p.id === 'review').status).toBe('succeeded')
    expect(report.phases.find(p => p.id === 'parent-readback').status).toBe('succeeded')
  })
  it('does not infer successful phases from a completed dispatch or hide missing phases', () => {
    const report = buildRunReport({ runId: 'run-2', scope: 'action', phases: [phase('dispatch')] })
    expect(report.phases).toHaveLength(RUN_PHASES.length)
    expect(report.phases.find(p => p.id === 'mesh')).toMatchObject({ started: null, status: 'unknown' })
    expect(report.outcome).toBe('partial')
    expect(report.sourceCycleComplete).toBe(false)
  })
  it('can complete an addressed scope with Mesh explicitly not run without completing the source cycle', () => {
    const report = buildRunReport({ runId: 'run-3', scope: 'action', phases: RUN_PHASES.map(id =>
      ['inventory', 'inbox', 'mesh', 'final-inbox'].includes(id) ? phase(id, 'not-run') : phase(id)) })
    expect(report).toMatchObject({ lifecycle: 'finished', outcome: 'succeeded', sourceCycleComplete: false })
  })
  it('requires a reason, evidence for success and consistent start state; rejects duplicate phase claims', () => {
    const base = { runId: 'run-4', scope: 'full' }
    for (const phases of [[{ ...phase('review'), evidence: [] }], [{ ...phase('mesh', 'blocked'), reason: '' }],
      [{ ...phase('mesh', 'not-run'), started: true }], [phase('review'), phase('review')]]) {
      expect(() => buildRunReport({ ...base, phases })).toThrow('run_report_invalid')
    }
  })
  it('terminal blocking preserves successful work and exact Mesh reason in the private report', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'education-report-'))
    try {
      const claimDir = resolve(root, '.local/education-sync-dispatch/claims')
      mkdirSync(claimDir, { recursive: true })
      const claimPath = resolve(claimDir, 'run-5.json')
      writeFileSync(claimPath, JSON.stringify({ requestId: 'run-5', token: 'secret-claim-token' }), { mode: 0o600 })
      saveRunReport(root, { runId: 'run-5', scope: 'full', phases: RUN_PHASES.map(id => id === 'mesh'
        ? { ...phase(id, 'blocked'), reason: 'HTTP 500; 7 / 42 дат.' } : phase(id)) })
      const result = finishDispatchReport(root, 'run-5', { status: 'blocked', reasonCode: 'source_unavailable' })
      expect(result).toMatchObject({ lifecycle: 'finished', outcome: 'partial', sourceCycleComplete: false })
      const claim = JSON.parse(readFileSync(claimPath, 'utf8'))
      const stored = claim.runReport
      expect(claim.token).toBe('secret-claim-token')
      expect(statSync(claimPath).mode & 0o077).toBe(0)
      expect(readdirSync(claimDir)).toEqual(['run-5.json'])
      expect(existsSync(resolve(root, '.local/education-run-reports'))).toBe(false)
      expect(result).not.toHaveProperty('reportPath')
      expect(stored.phases.find(p => p.id === 'mesh').reason).toBe('HTTP 500; 7 / 42 дат.')
      expect(stored.phases.find(p => p.id === 'review').status).toBe('succeeded')
      expect(JSON.stringify(result)).not.toContain('HTTP 500')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('returns a manual report without creating any files', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'education-report-'))
    try {
      expect(saveRunReport(root, { runId: 'manual', scope: 'full', phases: [] })).toMatchObject({ outcome: 'partial' })
      expect(readdirSync(root)).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('accepts report JSON through stdin without a separate input or output file', () => {
    const result = JSON.parse(execFileSync(process.execPath,
      [resolve(import.meta.dirname, '../scripts/education.mjs'), 'report', '-'],
      { input: JSON.stringify({ runId: 'manual-no-report-file-test', scope: 'action', phases: [] }), encoding: 'utf8' }))
    expect(result).toMatchObject({ lifecycle: 'finished', outcome: 'partial', sourceCycleComplete: false })
    expect(result).not.toHaveProperty('reportPath')
  })
})
