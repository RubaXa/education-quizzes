import { describe, expect, it } from 'vitest'
import { cardAdapter, languageRoutePatterns, learningRoutePatterns, missingMathRoutes, validLanguageRoute, validLearningRoute } from './card-policy.mjs'
import { publicPageSubjects } from './public-projection.mjs'

describe('stable written-language card contract', () => {
  for (const [name, pattern] of Object.entries(languageRoutePatterns)) {
    it(`selects and validates ${name} without exposing the parent guide`, () => {
      const task = {
        id: 'mesh-example', kind: 'written', instructionStatus: { state: 'reviewed' },
        cardPolicyVersion: 1, cardPattern: name, outputKind: pattern.kind,
      }
      const guide = {
        kind: pattern.kind, presentation: 'learning-route', pattern: name, revision: 1,
        stages: pattern.stages.map((id) => ({ id, expected: 'Сверенный ориентир',
          hintPreview: 'Наводящий вопрос', revealPreview: 'Открытый шаг', reviewLabels: ['Пункт'] })),
      }
      expect(cardAdapter('russian', task)).toBe('language-route')
      expect(validLanguageRoute(task, guide)).toBe(true)
      expect(validLanguageRoute(task, { ...guide, stages: guide.stages.slice(1) })).toBe(false)
      expect(validLanguageRoute(task, { ...guide, stages: guide.stages.map((stage) => ({ ...stage, hintPreview: '' })) })).toBe(false)
      const [publicSubject] = publicPageSubjects([{ id: 'russian', tasks: [{ ...task, parentGuide: guide }] }])
      expect(publicSubject.tasks[0].parentGuide).toBeUndefined()
      expect(publicSubject.tasks[0].cardPattern).toBe(name)
    })
  }

  it('keeps unscreened MESH text raw and rejects unknown patterns', () => {
    expect(cardAdapter('russian', { cardPattern: 'text-plan', instructionStatus: { state: 'needs-review' } })).toBe('raw-mesh')
    expect(cardAdapter('russian', { cardPattern: 'unknown', instructionStatus: { state: 'reviewed' } })).toBe('unsupported-pattern')
  })

  it('uses the same private guide for literary interpretation and science pairs', () => {
    for (const [subject, name, ids] of [
      ['literature', 'short-interpretation', ['theme', 'idea']],
      ['biology', 'concept-function', ['educational', 'covering']],
    ]) {
      const pattern = learningRoutePatterns[name]
      const task = { id: 'mesh-example', kind: 'written', cardPolicyVersion: 1, cardPattern: name, outputKind: pattern.kind, instructionStatus: { state: 'reviewed' } }
      const guide = { kind: pattern.kind, presentation: 'learning-route', pattern: name, revision: 1,
        stages: ids.map((id) => ({ id, expected: 'Сверено с оригиналом', hintPreview: 'Найди место', revealPreview: 'Этот фрагмент', reviewLabels: [id] })) }
      expect(cardAdapter(subject, task)).toBe('language-route')
      expect(validLearningRoute(subject, task, guide)).toBe(true)
      expect(validLearningRoute('russian', task, guide)).toBe(false)
      const [publicSubject] = publicPageSubjects([{ id: subject, tasks: [{ ...task, parentGuide: guide }] }])
      expect(publicSubject.tasks[0].parentGuide).toBeUndefined()
      expect(publicSubject.tasks[0].cardPattern).toBe(name)
    }
  })
})

describe('numbered mathematics parent route gate', () => {
  it('finds a missing guide even when a reviewed legacy sheet has no policy version', () => {
    const task = { kind: 'written', instructionStatus: { state: 'reviewed' }, problems: [
      { id: 'p06', parentGuide: { kind: 'worked-solution', presentation: 'math-route', stages: [] } },
      { id: 'p07' },
    ] }
    expect(missingMathRoutes('special', task)).toEqual(['p07'])
    expect(missingMathRoutes('special', { ...task, instructionStatus: { state: 'needs-review' } })).toEqual([])
    expect(missingMathRoutes('history', task)).toEqual([])
  })
})
