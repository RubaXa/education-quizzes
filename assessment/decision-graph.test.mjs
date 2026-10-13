import { describe, expect, it } from 'vitest'
import { validateAssessmentPlan, vocabularyDictationWords } from './decision-graph.mjs'

const words = ['tomatoes', 'rice', 'tea']
const checked = (entries) => entries.map(([wordId, status]) => ({ wordId, status }))

describe('vocabulary dictation selection', () => {
  it('checks the complete source list twice, then only unresolved spellings', () => {
    expect(vocabularyDictationWords({ phase: 'initial', sourceWordIds: words })).toEqual(words)
    expect(vocabularyDictationWords({ phase: 'full-repeat', sourceWordIds: words, priorWordIds: words,
      priorResults: checked([['tomatoes', 'incorrect'], ['rice', 'correct'], ['tea', 'correct']]) })).toEqual(words)
    expect(vocabularyDictationWords({ phase: 'repair', sourceWordIds: words, priorWordIds: words,
      priorResults: checked([['tomatoes', 'incorrect'], ['rice', 'correct'], ['tea', 'skipped']]) })).toEqual(['tomatoes', 'tea'])
    expect(vocabularyDictationWords({ phase: 'repair', sourceWordIds: words, priorWordIds: ['tomatoes', 'tea'],
      priorResults: checked([['tomatoes', 'correct'], ['tea', 'incorrect']]) })).toEqual(['tea'])
  })
  it('rechecks the complete list later, including words that were correct before', () => {
    expect(vocabularyDictationWords({ phase: 'delayed-full', sourceWordIds: words,
      priorWordIds: ['tomatoes'], priorResults: checked([['tomatoes', 'correct']]) })).toEqual(words)
  })
  it('stops on incomplete or unresolved feedback instead of silently dropping a word', () => {
    expect(() => vocabularyDictationWords({ phase: 'repair', sourceWordIds: words, priorWordIds: words,
      priorResults: checked([['tomatoes', 'incorrect'], ['rice', 'correct']]) })).toThrow('неполон')
    expect(() => vocabularyDictationWords({ phase: 'repair', sourceWordIds: words, priorWordIds: ['tomatoes'],
      priorResults: checked([['tomatoes', 'unresolved']]) })).toThrow('проверено')
    expect(() => vocabularyDictationWords({ phase: 'initial', sourceWordIds: ['tea', 'tea'] })).toThrow('уникальных')
  })
  it('requires free written production and a linked retest in the authoring gate', () => {
    const plan = { dictation: { phase: 'repair', sourceRef: 'verified-teacher-list', sourceWordIds: words,
      priorWordIds: words, priorResults: checked([['tomatoes', 'incorrect'], ['rice', 'correct'], ['tea', 'correct']]),
      wordIdByQuestion: { q1: 'tomatoes' } } }
    const open = { questions: [{ id: 'q1', kind: 'short' }], linkedToTestId: 'prior-test' }
    const good = validateAssessmentPlan(plan, open)
    expect(good.filter((error) => error.startsWith('Словарный диктант:'))).toEqual([])
    expect(good).not.toContain('Нет слоя current.')
    expect(good).not.toContain('Нет слоя transfer.')
    const choice = validateAssessmentPlan(plan, { ...open, questions: [{ id: 'q1', kind: 'single' }] })
    expect(choice.some((error) => error.startsWith('Словарный диктант:'))).toBe(true)
    const unlinked = validateAssessmentPlan(plan, { ...open, linkedToTestId: null })
    expect(unlinked.some((error) => error.startsWith('Словарный диктант:'))).toBe(true)
  })
})
