import { describe, it, expect } from 'vitest'
import { guidanceErrors, questionGuidanceErrors, repairQuestionGuidance } from './question-guidance.mjs'
const guidance = { observation: 'Сравни длительность подъёма воды с условием.', question: 'Какой признак отличает ежегодный подъём от кратковременного?',
  source: { title: 'География. Алексеев и др.', edition: '2024', section: '§ 35', pages: '114 (PDF 115)', locator: 'Первый абзац под заголовком о режиме реки.' } }
const entry = { guidance, sourceEvidence: ['checked-original/page-115.png'] }
const assignment = { testId: 'specific-test', answers: { q: 'Половодье ' }, questions: [{ id: 'q' }] }
const key = { entries: { q: { correct: 'половодье', accepted: ['половодье'], explanation: 'closed' } } }
const request = { testId: assignment.testId, reason: 'Original inspected', entries: { q: entry } }
describe('checked question guidance', () => {
  it('requires a complete, specific source and rejects generic copy, duplicate coaching and absent evidence', () => {
    expect(guidanceErrors(guidance)).toEqual([])
    expect(guidanceErrors({ ...guidance, source: { title: 'Учебник' } }).length).toBeGreaterThan(0)
    expect(guidanceErrors({ ...guidance, question: 'На каком шаге твоя запись перестаёт следовать условию?' })).not.toEqual([])
    expect(questionGuidanceErrors([{ id: 'a', answer: entry }, { id: 'b', answer: entry }]).join()).toContain('повторяется')
    expect(questionGuidanceErrors([{ id: 'a', answer: { guidance } }]).join()).toContain('sourceEvidence')
    expect(guidanceErrors({ ...guidance, source: { ...guidance.source, url: 'javascript:alert(1)' } })).not.toEqual([])
  })
  it('only enriches feedback, preserving the response, score-bearing keys and idempotency', () => {
    const original = JSON.stringify({ assignment, key })
    const result = repairQuestionGuidance(assignment, key, request)
    expect(result.changed).toEqual(['q'])
    expect(result.key.entries.q).toEqual({ ...key.entries.q, ...entry })
    expect(JSON.stringify({ assignment, key })).toBe(original)
    expect(repairQuestionGuidance(assignment, result.key, request).changed).toEqual([])
    expect(() => repairQuestionGuidance(assignment, key, { ...request, testId: 'other' })).toThrow()
    expect(() => repairQuestionGuidance(assignment, key, { ...request, entries: {} })).toThrow()
    expect(() => repairQuestionGuidance(assignment, key, { ...request, entries: { q: { ...entry, correct: 'different' } } })).toThrow()
  })
})
