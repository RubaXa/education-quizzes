/** @see ../docs/decisions/sync-phase-report-2026-10-29.md */
/** @see ../docs/modules/synchronization/execution-artifact.md#run-report */
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'

export const RUN_PHASES = Object.freeze(['inventory', 'inbox', 'mesh', 'actions', 'sources',
  'review', 'publication', 'student-readback', 'parent-readback', 'final-inbox', 'dispatch'])
const states = new Set(['succeeded', 'partial', 'failed', 'blocked', 'not-run', 'unknown'])
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4000
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)

// Missing evidence is never promoted to success by a queue acknowledgement.
export function buildRunReport(input, { finishedAt = new Date().toISOString() } = {}) {
  if (!validId(input?.runId) || !['full', 'action'].includes(input.scope) || !Array.isArray(input.phases)) {
    throw new Error('run_report_invalid')
  }
  const seen = new Set()
  for (const phase of input.phases) {
    if (!RUN_PHASES.includes(phase.id) || seen.has(phase.id) || !states.has(phase.status)
      || !text(phase.reason) || !Array.isArray(phase.evidence) || !phase.evidence.every(text)
      || (phase.status === 'not-run' ? phase.started !== false
        : phase.status === 'unknown' ? phase.started !== null : phase.started !== true)
      || (phase.status === 'succeeded' && phase.evidence.length === 0)) throw new Error('run_report_invalid')
    seen.add(phase.id)
  }
  const phases = RUN_PHASES.map(id => input.phases.find(phase => phase.id === id)
    ?? { id, started: null, status: 'unknown', reason: 'Нет подтверждения выполнения фазы.', evidence: [] })
  const successful = phases.some(p => p.status === 'succeeded')
  const failures = phases.some(p => ['failed', 'blocked'].includes(p.status))
  const gaps = phases.some(p => ['partial', 'unknown'].includes(p.status))
  return { schemaVersion: 1, runId: input.runId, scope: input.scope, lifecycle: 'finished', finishedAt,
    outcome: failures && !successful ? 'failed' : failures || gaps ? 'partial' : 'succeeded',
    sourceCycleComplete: input.scope === 'full'
      && phases.filter(p => ['inventory', 'inbox', 'mesh', 'final-inbox'].includes(p.id)).every(p => p.status === 'succeeded')
      && phases.every(p => ['succeeded', 'not-run'].includes(p.status)), phases }
}

export function saveRunReport(root, input) {
  const report = buildRunReport(input)
  // Reuse an active claim's control state; never create a separate report file.
  // Manual runs return the validated report on stdout only.
  const claimPath = resolve(root, '.local/education-sync-dispatch/claims', `${report.runId}.json`)
  if (existsSync(claimPath)) {
    const claim = JSON.parse(readFileSync(claimPath, 'utf8'))
    if (claim.requestId !== report.runId || typeof claim.token !== 'string' || !claim.token) throw new Error('run_report_invalid_claim')
    const temporary = `${claimPath}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify({ ...claim, runReport: report }) + '\n', { mode: 0o600 })
    renameSync(temporary, claimPath)
  }
  return report
}

export function finishDispatchReport(root, requestId, result) {
  const path = resolve(root, '.local/education-sync-dispatch/claims', `${requestId}.json`)
  const prior = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).runReport : null
  const phases = (prior?.phases ?? []).filter(p => p.id !== 'dispatch')
  phases.push({ id: 'dispatch', started: true, status: 'succeeded',
    reason: `Запрос закрыт со статусом ${result.status}${result.reasonCode ? ` (${result.reasonCode})` : ''}; это не подтверждает учебные фазы.`,
    evidence: [`dispatch:${requestId}:${result.status}`] })
  const report = saveRunReport(root, { runId: requestId, scope: prior?.scope ?? (result.scope === 'action' ? 'action' : 'full'), phases })
  return { lifecycle: report.lifecycle, outcome: report.outcome, sourceCycleComplete: report.sourceCycleComplete,
    phases: report.phases.map(({ id, started, status }) => ({ id, started, status })) }
}
