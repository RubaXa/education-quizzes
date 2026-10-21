import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { executeOperation } from './run-operation.mjs'
import { createTelemetry, parseTraceContext } from '../packages/education-runtime/telemetry.mjs'

const request = (operation, input = {}) => ({ schemaVersion: 1, operation, input })
const workspace = () => mkdtempSync(resolve(tmpdir(), 'education-run-'))
const execChild = promisify(execFile)

describe('operator execution receipts', () => {
  it('reports verified publication without implying workflow completion or exposing source payloads', async () => {
    const root = workspace()
    try {
      const runId = '2026-10-21-11111111-1111-4111-8111-111111111111'
      const receipt = `project-sync/audit-receipts/${runId}-12345678-abcd-1234-abcd-1234567890ab.json`
      const result = await executeOperation(request('project.audit', { runId }), { root,
        run: async () => ({ stdout: JSON.stringify({ runId, status: 'publication-verified', checkedDates: 42,
          readOnly: true, receiptReadOnly: true, workflowPhaseChanged: false, publicationVerified: true,
          blockedCount: 0, pendingPublicationDates: [], receipt, sourcePayload: 'PRIVATE_SOURCE' }) }) })
      expect(result.status).toBe('succeeded')
      expect(result.summary).toMatchObject({ publicationVerified: true, publicationState: 'publication-verified',
        workflowPhaseChanged: false, readOnly: true, receiptReadOnly: true, pendingPublicationCount: 0,
        auditReceipt: receipt })
      expect(JSON.stringify(result)).not.toContain('PRIVATE_SOURCE')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it.each(['pending', 'blocked'])('preserves a %s publication audit as partial', async (status) => {
    const root = workspace()
    try {
      const runId = '2026-10-21-11111111-1111-4111-8111-111111111111'
      const receipt = `project-sync/audit-receipts/${runId}-12345678-abcd-1234-abcd-1234567890ab.json`
      const result = await executeOperation(request('project.audit', { runId }), { root,
        run: async () => { throw Object.assign(new Error('publication incomplete'), { stdout: JSON.stringify({
          runId, status, checkedDates: 42, readOnly: true, receiptReadOnly: true, workflowPhaseChanged: false, receipt,
          blockedCount: status === 'blocked' ? 1 : 0, pendingPublicationDates: status === 'pending' ? [{ date: '2026-10-23', reasons: ['student:day-not-published'] }] : [],
        }) }) } })
      expect(result.status).toBe('partial')
      expect(result.summary.publicationVerified).toBe(false)
      expect(result.summary.publicationState).toBe(status)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('rejects an audit response lacking explicit read-only and unchanged-phase confirmation', async () => {
    const root = workspace()
    try {
      await expect(executeOperation(request('project.audit', { runId: '2026-10-21-11111111-1111-4111-8111-111111111111' }), { root,
        run: async () => ({ stdout: JSON.stringify({ status: 'publication-verified', checkedDates: 42, blockedCount: 0, pendingPublicationDates: [] }) }),
      })).rejects.toThrow('did not confirm completion')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it.each([
    ['missing receipt path', (payload) => { delete payload.receipt }],
    ['receipt for another run', (payload) => { payload.receipt = 'project-sync/audit-receipts/2026-10-21-22222222-2222-4222-8222-222222222222-12345678-abcd-1234-abcd-1234567890ab.json' }],
    ['receipt outside the private audit directory', (payload) => { payload.receipt = `../${payload.receipt}` }],
    ['missing receiptReadOnly confirmation', (payload) => { delete payload.receiptReadOnly }],
  ])('rejects %s for both success and partial audit results', async (_label, mutate) => {
    const root = workspace()
    const runId = '2026-10-21-11111111-1111-4111-8111-111111111111'
    const receipt = `project-sync/audit-receipts/${runId}-12345678-abcd-1234-abcd-1234567890ab.json`
    const verified = { runId, status: 'publication-verified', checkedDates: 42, readOnly: true, receiptReadOnly: true,
      workflowPhaseChanged: false, publicationVerified: true, blockedCount: 0, pendingPublicationDates: [], receipt }
    const partial = { runId, status: 'pending', checkedDates: 42, readOnly: true, receiptReadOnly: true,
      workflowPhaseChanged: false, blockedCount: 0, pendingPublicationDates: [{ date: '2026-10-23', reasons: ['parent:day-not-published'] }], receipt }
    try {
      mutate(verified)
      await expect(executeOperation(request('project.audit', { runId }), { root,
        run: async () => ({ stdout: JSON.stringify(verified) }) })).rejects.toThrow('did not confirm completion')
      mutate(partial)
      await expect(executeOperation(request('project.audit', { runId }), { root,
        run: async () => { throw Object.assign(new Error('pending'), { stdout: JSON.stringify(partial) }) } }))
        .rejects.toThrow('did not confirm completion')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('preserves the full scan snapshot privately without a second inbox query', async () => {
    const root = workspace()
    try {
      const result = await executeOperation(request('queue.scan'), { root, apply: true,
        run: async () => ({ stdout: JSON.stringify({ counts: { queued: 0 },
          inboxSnapshot: { complete: true, counts: { review: 0 }, items: [{ token: 'private-token' }] } }) }) })
      expect(result.summary.inbox).toEqual({ complete: true, counts: { review: 0 } })
      expect(JSON.stringify(result)).not.toContain('private-token')
      expect(readFileSync(result.journal, 'utf8')).toContain('private-token')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('reports a partial source collection with its timings instead of an uncertain create', async () => {
    const root = workspace()
    try {
      const result = await executeOperation(request('project.collect'), { root, apply: true,
        run: async () => { throw Object.assign(new Error('source blocked'), { stdout: JSON.stringify({
          runId: 'source-run', state: 'partially-collected', journal: '.local/source-run.json',
          timing: { elapsedMs: 15 }, report: { blockedChildren: 1 },
        }) }) } })
      expect(result.status).toBe('partial')
      expect(result.summary).toMatchObject({ sourceState: 'partially-collected',
        sourceJournal: '.local/source-run.json', timing: { elapsedMs: 15 } })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('propagates a safe trace parent to the child CLI and preserves the legacy metrics shape', async () => {
    const root = workspace()
    const events = []
    let childContext
    try {
      const result = await executeOperation(request('inbox.snapshot'), { root,
        telemetry: createTelemetry({ sink: (event) => events.push(event) }),
        run: async (_script, _argv, _cwd, options) => {
          childContext = parseTraceContext(options.env.EDUCATION_TRACE_CONTEXT)
          return { stdout: JSON.stringify({ complete: true, counts: { review: 0 } }), stderr: '' }
        } })
      expect(result.metrics).toMatchObject({ elapsedMs: expect.any(Number), preflightMs: null,
        stdoutBytes: expect.any(Number), stderrBytes: expect.any(Number) })
      expect(result.traceId).toMatch(/^[a-f0-9]{32}$/)
      expect(childContext.traceId).toBe(result.traceId)
      expect(childContext.spanId).toMatch(/^[a-f0-9]{32}$/)
      expect(result.telemetry.spans['operator.command'].count).toBe(1)
      expect(readFileSync(result.journal, 'utf8')).toContain('"traceId"')
      expect(events.some((event) => event.operation === 'operator.command')).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('propagates the active span through the production subprocess runner to a real child process', async () => {
    const root = workspace()
    const events = []
    const script = resolve(root, 'trace-child.mjs')
    writeFileSync(script, "process.stdout.write(JSON.stringify(JSON.parse(process.env.EDUCATION_TRACE_CONTEXT)))\n")
    try {
      const result = await executeOperation(request('inbox.snapshot'), { root,
        telemetry: createTelemetry({ sink: (event) => events.push(event) }),
        // Keep the production runner's environment composition; redirect only the executable script for this test.
        execFileRunner: (_file, _args, options) => execChild(process.execPath, [script], options),
      })
      const privateReceipt = JSON.parse(readFileSync(result.journal, 'utf8'))
      const childContext = JSON.parse(privateReceipt.stdout)
      const commandSpan = events.find((event) => event.kind === 'span' && event.operation === 'operator.command')
      expect(childContext.traceId).toBe(result.traceId)
      expect(childContext.spanId).toBe(commandSpan.spanId)
      expect(childContext.parentSpanId).toBe(commandSpan.parentSpanId)
      expect(privateReceipt.stdout).toMatch(/^\{"traceId":"[a-f0-9]{32}","spanId":"[a-f0-9]{32}","parentSpanId":"[a-f0-9]{32}"\}$/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('accepts an audited day only with an explicit empty problems array', async () => {
    const root = workspace()
    try {
      const options = (value) => ({ root, run: async () => ({ stdout: JSON.stringify(value) }) })
      const result = await executeOperation(request('day.audit'), options({ checkedDates: 13, problems: [] }))
      expect(result.summary).toMatchObject({ checkedDates: 13, problemCount: 0, verified: true })
      await expect(executeOperation(request('day.audit'), options({ checkedDates: 13, problems: ['missing-role'] })))
        .rejects.toThrow('did not confirm completion')
      await expect(executeOperation(request('day.audit'), options({ checkedDates: 13 })))
        .rejects.toThrow('did not confirm completion')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('records timing and a private output while exposing only a safe summary', async () => {
    const root = workspace()
    try {
      const result = await executeOperation(request('inbox.snapshot'), { root,
        run: async () => ({ stdout: JSON.stringify({ complete: true, counts: { review: 2 }, secretToken: 'do-not-print' }) }) })
      expect(result.summary).toEqual({ complete: true, counts: { review: 2 }, measurements: null })
      expect(result.metrics.elapsedMs).toBeGreaterThanOrEqual(0)
      expect(JSON.stringify(result)).not.toContain('do-not-print')
      expect(readFileSync(result.journal, 'utf8')).toContain('do-not-print')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('never silently creates the same quiz twice', async () => {
    const root = workspace()
    try {
      writeFileSync(resolve(root, 'quiz.json'), '{}')
      let calls = 0
      const options = { root, apply: true, run: async (_script, argv) => {
        calls++
        return { stdout: argv[0] === 'create' ? '{"testId":"published-id"}' : '{"valid":true}' }
      } }
      const first = await executeOperation(request('quiz.publish', { specPath: 'quiz.json', personId: 'student-id' }), options)
      const second = await executeOperation(request('quiz.publish', { specPath: 'quiz.json', personId: 'student-id' }), options)
      expect(first.status).toBe('succeeded')
      expect(second.status).toBe('reused')
      expect(calls).toBe(2) // validate, then create; the repeated request invokes neither.
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('requires readback after an uncertain create failure', async () => {
    const root = workspace()
    try {
      writeFileSync(resolve(root, 'review.json'), '{}')
      const operation = request('review.publish', { reviewPath: 'review.json' })
      await expect(executeOperation(operation, { root, apply: true,
        run: async (_script, argv) => {
          if (argv[0] === 'validate') return { stdout: '{"valid":true}' }
          throw new Error('connection lost after write')
        } })).rejects.toThrow('did not confirm completion')
      await expect(executeOperation(operation, { root, apply: true,
        run: async () => ({ stdout: '{}' }) })).rejects.toThrow('needs readback')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('does not mark an unverified review response as successful', async () => {
    const root = workspace()
    try {
      writeFileSync(resolve(root, 'review.json'), '{}')
      const operation = request('review.publish', { reviewPath: 'review.json' })
      await expect(executeOperation(operation, { root, apply: true,
        run: async (_script, argv) => ({ stdout: argv[0] === 'validate'
          ? '{"valid":true}' : '{"publishedToFirebase":true,"verified":false}' }) }))
        .rejects.toThrow('did not confirm completion')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('revises an unopened quiz through validate, guarded write and readback', async () => {
    const root = workspace()
    try {
      writeFileSync(resolve(root, 'quiz.json'), '{"assessmentPlanPath":"./plan.json"}')
      writeFileSync(resolve(root, 'plan.json'), '{}')
      const called = []
      const operation = request('quiz.revise-open', { learnerToken: 'old-token', specPath: 'quiz.json', personId: 'student-id' })
      const result = await executeOperation(operation, { root, apply: true,
        run: async (_script, argv) => {
          called.push(argv)
          return { stdout: argv[0] === 'validate' ? 'validated' : '{"testId":"same-id","questionCount":9,"revised":true,"verified":true}' }
        } })
      expect(called).toEqual([['validate', 'quiz.json'], ['revise-open', 'old-token', 'quiz.json', 'student-id']])
      expect(result.summary).toEqual({ questionCount: 9, revised: true, verified: true })
      expect((await executeOperation(operation, { root, apply: true, run: async () => { throw new Error('repeated write') } })).status).toBe('reused')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
