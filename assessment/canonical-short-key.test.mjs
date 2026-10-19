import { describe, expect, it } from 'vitest'
import { canonicalShortKeyRepair } from './canonical-short-key.mjs'
import { grade, summarize } from '../src/lib/quiz.ts'

const assignment = { testId: 'test', status: 'submitted', answers: { flood: 'Половодье ', salt: '%' }, questions: [
  { id: 'flood', kind: 'short', points: 1 }, { id: 'salt', kind: 'short', points: 1 },
] }
const key = { entries: { flood: { correct: 'половодье', accepted: ['половодьем'] }, salt: { correct: 'промилле', accepted: ['‰'] } } }
const request = { testId: 'test', questionIds: ['flood'], reason: 'Original confirms canonical term.', evidenceRefs: ['book:114'] }

describe('canonical short key recovery', () => {
  it('reproduces the false zero and repairs only the declared canonical form', () => {
    const before = structuredClone({ assignment, key })
    expect(summarize(grade(assignment, key)).earned).toBe(0)
    const repaired = canonicalShortKeyRepair(assignment, key, request)
    expect(repaired.changed).toEqual(['flood'])
    expect(summarize(grade(assignment, repaired.key)).earned).toBe(1)
    expect(grade(assignment, repaired.key)[1].points).toBe(0)
    expect({ assignment, key }).toEqual(before)
    expect(repaired.key.entries.salt).toEqual(key.entries.salt)
    expect(canonicalShortKeyRepair(assignment, repaired.key, request).changed).toEqual([])
  })
  it('rejects another test, an open attempt, missing evidence and duplicate IDs', () => {
    for (const bad of [{ ...request, testId: 'other' }, { ...request, evidenceRefs: [] }, { ...request, questionIds: ['flood', 'flood'] }]) {
      expect(() => canonicalShortKeyRepair(assignment, key, bad)).toThrow()
    }
    expect(() => canonicalShortKeyRepair({ ...assignment, status: 'open' }, key, request)).toThrow()
  })
  it('refuses answer replacement and non-short questions', () => {
    expect(() => canonicalShortKeyRepair(assignment, { entries: { flood: { correct: 'new' } } }, request)).toThrow()
    expect(() => canonicalShortKeyRepair({ ...assignment, questions: [{ id: 'flood', kind: 'single' }] }, key, request)).toThrow()
  })
})
