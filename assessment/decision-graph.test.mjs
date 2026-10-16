import { describe, expect, it } from 'vitest'
import { validateAssessmentPlan, validateVocabularySourceCoverage, vocabularyDictationWords } from './decision-graph.mjs'

const words = ['tomatoes', 'rice', 'tea']
const checked = (entries) => entries.map(([wordId, status]) => ({ wordId, status }))

describe('vocabulary dictation selection', () => {
  it('requires the union of words from every assigned exercise, including the next page', () => {
    const coverage = { assignedMaterialRefs: ['starlight-6:25:vocabulary', 'starlight-6:26:ex1'],
      sourceCoverage: [
        { ref: 'starlight-6:25:vocabulary', evidenceRef: 'family-pdf:25', verified: true, wordIds: ['tomatoes', 'tea'] },
        { ref: 'starlight-6:26:ex1', evidenceRef: 'family-pdf:26', verified: true, wordIds: ['broccoli'] },
      ], sourceWordIds: ['tomatoes', 'tea', 'broccoli'] }
    expect(validateVocabularySourceCoverage(coverage)).toEqual([])
    expect(validateVocabularySourceCoverage({ ...coverage, sourceWordIds: ['tomatoes', 'tea'] }))
      .toContain('Список диктанта не совпадает с объединением слов назначенных упражнений.')
    expect(validateVocabularySourceCoverage({ ...coverage, sourceCoverage: coverage.sourceCoverage.slice(0, 1) }).length).toBeGreaterThan(0)
    expect(validateVocabularySourceCoverage({ ...coverage, sourceCoverage: coverage.sourceCoverage.map((item) =>
      item.ref.endsWith(':ex1') ? { ...item, verified: false } : item) }).length).toBeGreaterThan(0)
  })
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
      assignedMaterialRefs: ['teacher-list'], sourceCoverage: [{ ref: 'teacher-list', evidenceRef: 'family-original',
        verified: true, wordIds: words }],
      priorWordIds: words, priorResults: checked([['tomatoes', 'incorrect'], ['rice', 'correct'], ['tea', 'correct']]),
      wordIdByQuestion: { q1: 'tomatoes' } } }
    const open = { questions: [{ id: 'q1', kind: 'short' }], linkedToTestId: 'prior-test' }
    const good = validateAssessmentPlan(plan, open)
    expect(good.filter((error) => error.startsWith('Словарный диктант:'))).toEqual([])
    const incomplete = validateAssessmentPlan({ dictation: { ...plan.dictation, sourceCoverage: [] } }, open)
    expect(incomplete.some((error) => error.includes('все назначенные упражнения'))).toBe(true)
    expect(good).not.toContain('Нет слоя current.')
    expect(good).not.toContain('Нет слоя transfer.')
    const choice = validateAssessmentPlan(plan, { ...open, questions: [{ id: 'q1', kind: 'single' }] })
    expect(choice.some((error) => error.startsWith('Словарный диктант:'))).toBe(true)
    const unlinked = validateAssessmentPlan(plan, { ...open, linkedToTestId: null })
    expect(unlinked.some((error) => error.startsWith('Словарный диктант:'))).toBe(true)
  })
})

/** @see ../docs/product/quiz-chain-proposal.md */
it('does not invent prior mistakes or a missing baseline after a wholly perfect history', () => {
  const plan = { items: [{ questionId: 'a', layer: 'current' }, { questionId: 'b', layer: 'spaced' }, { questionId: 'c', layer: 'transfer' }] }
  const spec = { questions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], linkedToTestId: 'perfect' }
  const error = 'Нет слоя прежней ошибки или честной входной проверки.'
  expect(validateAssessmentPlan(plan, spec)).toContain(error)
  expect(validateAssessmentPlan({ ...plan, continuation: { strategy: 'consolidation' } }, spec)).not.toContain(error)
})
