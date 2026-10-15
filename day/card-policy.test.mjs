import { describe, expect, it } from 'vitest'
import { cardAdapter, languageRoutePatterns, learningRoutePatterns, missingMathRoutes, practiceVariantErrors, sourceInventoryErrors, validLanguageRoute, validLearningRoute } from './card-policy.mjs'
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

  it('keeps each assigned MESH exercise as a separate required route stage', () => {
    const task = { id: 'mesh-351902085', kind: 'written', cardPolicyVersion: 1, cardPattern: 'source-units',
      outputKind: 'structured-notes', instructionStatus: { state: 'reviewed' },
      steps: [{ text: 'В упр. 218 выпиши сравнения.' }, { text: 'В упр. 223 выпиши олицетворения.' }] }
    const stage = (id) => ({ id, expected: 'Выписать назначенные выражения', hintPreview: 'Найди выражения в тексте',
      revealPreview: 'Сверь запись с оригиналом', reviewLabels: [id] })
    const guide = { kind: 'structured-notes', presentation: 'learning-route', pattern: 'source-units', revision: 2,
      stages: [stage('mesh-218'), stage('mesh-223')] }
    expect(validLearningRoute('russian', task, guide)).toBe(true)
    expect(validLearningRoute('russian', task, { ...guide, stages: [stage('assignment'), stage('evidence')] })).toBe(false)
    expect(validLearningRoute('russian', task, { ...guide, stages: [stage('mesh-218')] })).toBe(false)
    expect(validLearningRoute('russian', task, { ...guide, stages: [...guide.stages, stage('method-218')] })).toBe(false)
  })
})

describe('numbered mathematics parent route gate', () => {
  it('checks every source variant and printed number against a separately inspected original', () => {
    const ref = 'mesh-attachment:sheet#1'
    const sha = 'a'.repeat(64)
    const links = [{ sourceType: 'teacher-attachment', sourceRef: ref, sourceSha256: sha }]
    const task = { id: 'mesh-1', kind: 'check', mathRoutePolicyVersion: 2, instructionStatus: { state: 'reviewed' },
      practiceVariants: [{ id: 'mesh-1-v1', title: 'Вариант 1' }, { id: 'mesh-1-v2', title: 'Вариант 2' }],
      sourceInventory: { resultMode: 'optional-practice', sources: [{ sourceRef: ref, sourceSha256: sha,
        evidenceRef: 'work/source.md', groups: [
          { variantId: 'mesh-1-v1', numbers: [1, 2] }, { variantId: 'mesh-1-v2', numbers: [1, 2] },
        ] }] },
      problems: [1, 2].flatMap((number) => ['mesh-1-v1', 'mesh-1-v2'].map((variantId) => ({ variantId, number }))),
    }
    expect(sourceInventoryErrors(task, links)).toEqual([])
    expect(sourceInventoryErrors({ ...task, problems: task.problems.slice(0, -1) }, links)).toEqual(expect.arrayContaining([expect.stringMatching(/Номера/)]))
    expect(sourceInventoryErrors({ ...task, practiceVariants: task.practiceVariants.slice(0, 1) }, links)).toEqual(expect.arrayContaining([expect.stringMatching(/Варианты/)]))
    expect(sourceInventoryErrors({ ...task, kind: 'written' }, links)).toEqual(expect.arrayContaining([expect.stringMatching(/Вид работы/)]))
    expect(sourceInventoryErrors(task, [{ ...links[0], sourceSha256: 'b'.repeat(64) }])).toEqual(expect.arrayContaining([expect.stringMatching(/оригинала/)]))
    expect(sourceInventoryErrors({ ...task, sourceInventory: undefined }, links)).not.toEqual([])
    expect(sourceInventoryErrors({ ...task, mathRoutePolicyVersion: 1, sourceInventory: undefined }, links)).toEqual([])
    expect(sourceInventoryErrors({ ...task, meshText: 'Решать задания из файла' }, [])).toEqual(expect.arrayContaining([expect.stringMatching(/файл учителя/)]))
    expect(sourceInventoryErrors(task, [...links, { sourceType: 'teacher-attachment', sourceRef: 'mesh-attachment:second#1', sourceSha256: 'b'.repeat(64) }]))
      .toEqual(expect.arrayContaining([expect.stringMatching(/каждого файла/)]))
    const second = { sourceType: 'teacher-attachment', sourceRef: 'mesh-attachment:second#1', sourceSha256: 'b'.repeat(64) }
    const split = { ...task, sourceInventory: { ...task.sourceInventory, sources: [
      { ...task.sourceInventory.sources[0], groups: [{ variantId: 'mesh-1-v1', numbers: [1, 2] }] },
      { sourceRef: second.sourceRef, sourceSha256: second.sourceSha256, evidenceRef: 'work/second.md',
        groups: [{ variantId: 'mesh-1-v2', numbers: [1, 2] }] },
    ] } }
    expect(sourceInventoryErrors(split, [...links, second])).toEqual([])
  })
  it('accepts two sourced practice variants with repeated printed numbers and stable distinct IDs', () => {
    const task = { id: 'mesh-1', kind: 'check', instructionStatus: { state: 'reviewed' },
      practiceVariants: [{ id: 'mesh-1-v1', title: 'Вариант 1' }, { id: 'mesh-1-v2', title: 'Вариант 2' }],
      problems: [{ id: 'mesh-1-p-v1-01', variantId: 'mesh-1-v1', number: 1 },
        { id: 'mesh-1-p-v2-01', variantId: 'mesh-1-v2', number: 1 }] }
    expect(practiceVariantErrors(task)).toEqual([])
    expect(cardAdapter('math', task)).toBe('math-solution')
    expect(practiceVariantErrors({ ...task, problems: task.problems.slice(0, 1) })).not.toEqual([])
  })
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
