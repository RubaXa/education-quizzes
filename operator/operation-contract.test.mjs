import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { operationCatalog, operationCommand, operationFingerprint, validateOperationRequest } from './operation-contract.mjs'

const request = (operation, input = {}) => ({ schemaVersion: 1, operation, input })

describe('stable operator operation contract', () => {
  it('routes audio through typed operations with write gates and a read-only binding preview', () => {
    expect(() => operationCommand(request('audio.sync'), false)).toThrow('requires --apply')
    expect(operationCommand(request('audio.sync', { trackId: 'starlight-6-wb-02', refresh: true }), true)).toEqual({
      script: 'scripts/audio-library.mjs', argv: ['sync', 'starlight-6-wb-02', '--refresh'],
    })
    expect(operationCommand(request('audio.link', { bindingPath: '.local/audio-binding.json' }), false).argv).toEqual(['link', '.local/audio-binding.json'])
    expect(() => operationCommand(request('audio.sync', { trackId: '../../secret' }), true)).toThrow('invalid input.trackId')
  })
  it('exposes saved-run publication audit as a typed read operation without apply', () => {
    const runId = '2026-10-21-11111111-1111-4111-8111-111111111111'
    expect(operationCommand(request('project.audit', { runId }), false)).toEqual({
      script: 'scripts/sync-project.mjs', argv: ['audit', '--run', runId],
    })
    expect(operationCatalog().find((item) => item.id === 'project.audit')).toMatchObject({ effect: 'read', input: ['runId'] })
    expect(() => operationCommand(request('project.audit', { runId: '../other' }), false)).toThrow('invalid input.runId')
    expect(() => operationCommand(request('project.audit', { runId, complete: true }), false)).toThrow('unknown input.complete')
  })

  it('has one discoverable route per repeatable Education operation', () => {
    const ids = operationCatalog().map((item) => item.id)
    expect(ids).toContain('project.collect')
    expect(ids).toContain('inbox.snapshot')
    expect(ids).toContain('quiz.publish')
    expect(ids).toContain('quiz.revise-open')
    expect(ids).toContain('review.publish')
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of operationCatalog()) {
      expect(item.purpose.length).toBeGreaterThan(15)
      expect(item.interpretation.length).toBeGreaterThan(30)
    }
  })

  it('rejects arbitrary fields and unapproved writes', () => {
    expect(() => validateOperationRequest({ ...request('queue.list'), script: 'anything' })).toThrow('unknown fields')
    expect(() => validateOperationRequest(request('unknown.operation'))).toThrow('Unknown operation')
    expect(() => operationCommand(request('quiz.publish', { specPath: 'spec.json', personId: 'student-id' }), false)).toThrow('requires --apply')
    expect(() => operationCommand(request('quiz.revise-open', { learnerToken: 'test-token', specPath: 'spec.json', personId: 'student-id' }), false)).toThrow('requires --apply')
    expect(() => validateOperationRequest(request('quiz.publish', { specPath: 'spec.json' }))).toThrow('invalid input.personId')
    expect(() => operationCommand(request('project.collect'), false)).toThrow('requires --apply')
    expect(() => operationCommand(request('queue.scan'), false)).toThrow('requires --apply')
    expect(operationCommand(request('queue.list'), false)).toEqual({ script: 'scripts/sync-queue.mjs', argv: ['list'] })
  })

  it('does not expose unverified project completion as a generic operation', () => {
    expect(() => validateOperationRequest(request('project.phase', { phase: 'complete', evidence: 'claimed' })))
      .toThrow('Unknown operation')
  })

  it('fingerprints the payload bytes, so editing a quiz is a new revision', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'education-operation-'))
    try {
      const path = resolve(directory, 'quiz.json')
      writeFileSync(path, '{"title":"first","assessmentPlanPath":"./plan.json"}')
      writeFileSync(resolve(directory, 'plan.json'), '{"revision":1}')
      const before = operationFingerprint(request('quiz.publish', { specPath: path, personId: 'student-id' }), directory)
      writeFileSync(resolve(directory, 'plan.json'), '{"revision":2}')
      const afterPlanChange = operationFingerprint(request('quiz.publish', { specPath: path, personId: 'student-id' }), directory)
      expect(afterPlanChange).not.toBe(before)
      writeFileSync(path, '{"title":"second","assessmentPlanPath":"./plan.json"}')
      expect(operationFingerprint(request('quiz.publish', { specPath: path, personId: 'student-id' }), directory)).not.toBe(afterPlanChange)
      const revision = request('quiz.revise-open', { learnerToken: 'token', specPath: path, personId: 'student-id' })
      const revisionBefore = operationFingerprint(revision, directory)
      writeFileSync(resolve(directory, 'plan.json'), '{"revision":3}')
      expect(operationFingerprint(revision, directory)).not.toBe(revisionBefore)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
