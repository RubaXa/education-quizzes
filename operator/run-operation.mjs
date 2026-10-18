/**
 * @see ../docs/operations/recovery.md
 */
/** One execution and one private receipt for every operator operation.
 * @see ../docs/services/operator-cli/README.md#execution */
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { createRotatingJsonlSink, createTelemetry, parseTraceContext } from '../packages/education-runtime/telemetry.mjs'
import { operationCommand, operationFingerprint, validateOperationRequest } from './operation-contract.mjs'

const exec = promisify(execFile)
const now = () => new Date().toISOString()
const writePrivateJson = (path, value) => {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}
const parseJson = (value) => {
  try { return JSON.parse(value) } catch { return null }
}
const publicSummary = (operation, value) => {
  const parsed = parseJson(value)
  if (!parsed || typeof parsed !== 'object') return { parsed: false }
  if (operation === 'project.plan') return { families: parsed.families ?? null, children: parsed.children ?? null,
    sourceAccounts: parsed.sourceAccounts ?? null, syncTargetsQueued: parsed.queued ?? null,
    sourceTargetsBlocked: parsed.blocked ?? null, measurements: parsed.measurements ?? null }
  if (operation === 'inbox.snapshot') return { complete: parsed.complete === true, counts: parsed.counts ?? null,
    measurements: parsed.measurements ?? null }
  if (operation.startsWith('queue.')) return { counts: parsed.counts ?? null, created: parsed.created ?? null,
    resolved: parsed.resolved ?? null,
    inbox: parsed.inboxSnapshot ? { complete: parsed.inboxSnapshot.complete === true, counts: parsed.inboxSnapshot.counts ?? null } : null,
    measurements: parsed.measurements ?? null }
  if (operation === 'grades.snapshot') return { changedSubjects: parsed.changedSubjects ?? null,
    unchanged: parsed.unchanged ?? null, applied: parsed.applied ?? null }
  if (operation === 'project.collect') return { runId: parsed.runId ?? null, sourceState: parsed.state ?? null,
    sourceJournal: parsed.journal ?? null, report: parsed.report ?? null, timing: parsed.timing ?? null }
  if (operation === 'day.audit') return { checkedDates: parsed.checkedDates ?? null,
    problemCount: Array.isArray(parsed.problems) ? parsed.problems.length : null,
    verified: Array.isArray(parsed.problems) && parsed.problems.length === 0,
    measurements: parsed.measurements ?? null }
  if (operation === 'grades.publish') return { changed: parsed.changed ?? null, verified: parsed.verified ?? null }
  if (operation === 'review.validate') return { valid: parsed.valid === true,
    tasks: Array.isArray(parsed.taskIds) ? parsed.taskIds.length : null,
    reviewedPhotos: parsed.reviewedPhotos ?? null }
  if (operation === 'review.publish') return { reviewedPhotos: parsed.reviewedPhotos ?? null,
    taskStatuses: parsed.taskStatuses ?? null, publishedToFirebase: parsed.publishedToFirebase === true,
    verified: parsed.verified === true }
  if (operation === 'quiz.publish') return { published: typeof parsed.testId === 'string' && parsed.testId.length > 0,
    readback: typeof parsed.testId === 'string' && parsed.testId.length > 0 }
  if (operation === 'quiz.revise-open') return { questionCount: parsed.questionCount ?? null,
    revised: parsed.revised === true, verified: parsed.verified === true }
  return { parsed: true }
}

async function executeOperationInternal(request, { apply = false, root = resolve(import.meta.dirname, '..'),
  journalDir = resolve(root, '.local/operator-runs'), run = (script, argv, cwd, child = {}) => exec(process.execPath,
    [script, ...argv], { cwd, env: { ...process.env, ...child.env }, maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 }), telemetry } = {}) {
  const descriptor = validateOperationRequest(request)
  const command = operationCommand(request, apply)
  const fingerprint = operationFingerprint(request, root)
  mkdirSync(journalDir, { recursive: true, mode: 0o700 })
  const invoke = (stage, script, argv) => {
    const call = () => run(resolve(root, script), argv, root, { env: {
      EDUCATION_TRACE_CONTEXT: telemetry?.serializeContext?.() ?? '',
    } })
    return telemetry?.span ? telemetry.span(`operator.${stage}`, call, { stage }) : call()
  }
  const receipt = resolve(journalDir, `${fingerprint}.json`)
  if (apply && descriptor.effect === 'create') {
    let previous = null
    try { previous = JSON.parse(readFileSync(receipt, 'utf8')) } catch { /* First attempt. */ }
    if (previous?.status === 'succeeded') return { status: 'reused', operation: request.operation,
      fingerprint, journal: receipt, summary: previous.summary, metrics: previous.metrics,
      traceId: telemetry?.current?.().traceId ?? null, telemetry: telemetry?.snapshot?.() ?? null }
    if (previous) throw new Error(`Previous ${request.operation} attempt needs readback: ${receipt}`)
  }
  const runId = randomUUID()
  const journal = resolve(journalDir, `${runId}.json`)
  const startedAt = now()
  const started = performance.now()
  const base = { schemaVersion: 1, runId, operation: request.operation, fingerprint, apply,
    traceId: telemetry?.current?.().traceId ?? null,
    request, command, startedAt }
  let preflightMs = null
  if (apply && descriptor.preflight) {
    const preflightStarted = performance.now()
    try {
      const validationArgv = request.operation === 'quiz.revise-open'
        ? [descriptor.preflight, request.input.specPath]
        : [descriptor.preflight, ...descriptor.argv(request.input, false)]
      await invoke('preflight', descriptor.script, validationArgv)
      preflightMs = Math.round(performance.now() - preflightStarted)
    } catch (error) {
      const failure = { ...base, finishedAt: now(), status: 'invalid',
        metrics: { elapsedMs: Math.round(performance.now() - started), preflightMs: Math.round(performance.now() - preflightStarted) },
        telemetry: telemetry?.snapshot?.() ?? null,
        error: String(error?.message ?? error), stdout: error?.stdout ?? '', stderr: error?.stderr ?? '' }
      writePrivateJson(journal, failure)
      throw new Error(`${request.operation} validation failed; inspect private journal ${journal}`)
    }
  }
  if (apply && descriptor.effect === 'create') writePrivateJson(receipt, { ...base, status: 'started' })
  try {
    const { stdout = '', stderr = '' } = await invoke('command', command.script, command.argv)
    const metrics = { elapsedMs: Math.round(performance.now() - started), preflightMs,
      stdoutBytes: Buffer.byteLength(stdout),
      stderrBytes: Buffer.byteLength(stderr) }
    const summary = publicSummary(request.operation, stdout)
    if (request.operation === 'quiz.publish' && summary.readback !== true) {
      throw new Error('Quiz publication did not return a read-back testId.')
    }
    if (request.operation === 'review.publish' && summary.verified !== true) {
      throw new Error('Review publication did not confirm addressable readback.')
    }
    if (request.operation === 'quiz.revise-open' && summary.verified !== true) {
      throw new Error('Quiz revision did not confirm role-index readback.')
    }
    if (request.operation === 'day.audit' && summary.verified !== true) throw new Error('Published day audit is incomplete or contains problems.')
    const telemetrySummary = telemetry?.snapshot?.() ?? null
    const result = { ...base, finishedAt: now(), status: 'succeeded', summary, metrics,
      telemetry: telemetrySummary, stdout, stderr }
    writePrivateJson(journal, result)
    if (apply && descriptor.effect === 'create') writePrivateJson(receipt, { ...base, finishedAt: result.finishedAt,
      status: 'succeeded', summary, metrics, telemetry: telemetrySummary, journal })
    return { status: 'succeeded', operation: request.operation, fingerprint, journal, summary, metrics,
      traceId: base.traceId, telemetry: telemetrySummary }
  } catch (error) {
    const partial = request.operation === 'project.collect' ? parseJson(error?.stdout ?? '') : null
    if (partial?.runId && ['blocked', 'partially-collected'].includes(partial.state)) {
      const summary = publicSummary(request.operation, error.stdout)
      const metrics = { elapsedMs: Math.round(performance.now() - started) }
      const telemetrySummary = telemetry?.snapshot?.() ?? null
      writePrivateJson(journal, { ...base, finishedAt: now(), status: 'partial', summary, metrics, telemetry: telemetrySummary,
        stdout: error.stdout, stderr: error.stderr ?? '' })
      return { status: 'partial', operation: request.operation, fingerprint, journal, summary, metrics,
        traceId: base.traceId, telemetry: telemetrySummary }
    }
    const telemetrySummary = telemetry?.snapshot?.() ?? null
    const result = { ...base, finishedAt: now(), status: descriptor.effect === 'create' ? 'needs-readback' : 'failed',
      metrics: { elapsedMs: Math.round(performance.now() - started) },
      telemetry: telemetrySummary,
      error: String(error?.message ?? error), stdout: error?.stdout ?? '', stderr: error?.stderr ?? '' }
    writePrivateJson(journal, result)
    if (apply && descriptor.effect === 'create') writePrivateJson(receipt, { ...base,
      status: 'needs-readback', journal, finishedAt: result.finishedAt })
    throw new Error(`${request.operation} did not confirm completion; inspect private journal ${journal}`)
  }
}

/** One trace per operator request; children receive only opaque trace identifiers. */
export async function executeOperation(request, options = {}) {
  const root = options.root ?? resolve(import.meta.dirname, '..')
  const journalDir = options.journalDir ?? resolve(root, '.local/operator-runs')
  mkdirSync(journalDir, { recursive: true, mode: 0o700 })
  const propagated = parseTraceContext(process.env.EDUCATION_TRACE_CONTEXT)
  const telemetry = options.telemetry ?? createTelemetry({
    sink: createRotatingJsonlSink(resolve(journalDir, 'telemetry.jsonl')),
    traceId: propagated?.traceId,
    parentSpanId: propagated?.spanId,
  })
  const { telemetry: _ignored, ...rest } = options
  const childExec = options.execFileRunner ?? exec
  const run = options.run ?? ((script, argv, cwd, child = {}) => childExec(process.execPath, [script, ...argv], {
    cwd, env: { ...process.env, ...child.env }, maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000,
  }))
  return telemetry.trace('operator.operation', () => executeOperationInternal(request,
    { ...rest, root, journalDir, telemetry, run }), { operation: request?.operation, consumer: 'operator' })
}
