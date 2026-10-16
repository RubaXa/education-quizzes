import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { executeOperation } from './run-operation.mjs'

const request = (operation, input = {}) => ({ schemaVersion: 1, operation, input })
const workspace = () => mkdtempSync(resolve(tmpdir(), 'education-run-'))

describe('operator execution receipts', () => {
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
