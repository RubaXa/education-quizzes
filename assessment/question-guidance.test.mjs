import { describe, it, expect } from 'vitest'
import { guidanceErrors, questionGuidanceErrors, repairQuestionGuidance, publishedAnswer } from './question-guidance.mjs'
const guidance = { presentation:{version:1,activity:{kind:'mark',label:'Два признака из вопроса',instruction:'Выдели признак, который сравниваешь с текстом.',tokens:[{id:'year',text:'Ежегодный подъём'},{id:'short',text:'Кратковременный подъём'}]}},observation: 'Сравни длительность подъёма воды с условием.', question: 'Какой признак отличает ежегодный подъём от кратковременного?',
  source: { title: 'География. Алексеев и др.', edition: '2024', section: '§ 35', pages: '114 (PDF 115)', locator: 'Первый абзац под заголовком о режиме реки.' } }
const entry = { guidance, sourceEvidence: ['checked-original/page-115.png'] }
const assignment = { testId: 'specific-test', answers: { q: 'Половодье ' }, questions: [{ id: 'q' }] }
const key = { entries: { q: { correct: 'половодье', accepted: ['половодье'], explanation: 'closed' } } }
const request = { testId: assignment.testId, reason: 'Original inspected', entries: { q: entry } }
describe('checked question guidance', () => {
  it('accepts an explained execution only with source code and rejects an empty input or missing trace', () => {
    const explained = {mode:'program-explanation',observation:'while проверяет условие до первого прохода.',reason:'0 > 0 ложно; n остаётся равным 6.',source:guidance.source,
      presentation:{version:1,visual:{kind:'comparison',label:'Ход программы',columns:['Шаг','n'],rows:[{cells:['Начало','6']},{cells:['Условие ложно → выход','6']}]},details:[{label:'Как читать while',text:'Сначала проверка, затем тело. Если проверка ложна сразу, тело не выполняется.'}]}}
    const item={id:'program',code:'n = 6\nwhile False:\n    n += 1\nprint(n)',answer:{guidance:explained,sourceEvidence:['checked-program']}}
    expect(questionGuidanceErrors([item])).toEqual([])
    expect(questionGuidanceErrors([{...item,code:undefined}]).join()).toContain('видимый код')
    expect(guidanceErrors({...explained,question:'Посчитай значение самостоятельно.'}).length).toBeGreaterThan(0)
    expect(guidanceErrors({...explained,presentation:{...explained.presentation,activity:guidance.presentation.activity}}).length).toBeGreaterThan(0)
    expect(guidanceErrors({...explained,presentation:{version:1}}).length).toBeGreaterThan(0)
    const repaired=repairQuestionGuidance({testId:'p',questions:[{id:'program',code:item.code}]},{entries:{program:{correct:'6'}}},{testId:'p',reason:'Parent requested an explanation',entries:{program:item.answer}})
    expect(repaired.key.entries.program.correct).toBe('6')
  })
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
    expect(result.key.entries.q).toEqual({ ...key.entries.q, guidance })
    expect(result.key.entries.q).not.toHaveProperty('sourceEvidence')
    expect(JSON.stringify({ assignment, key })).toBe(original)
    expect(repairQuestionGuidance(assignment, result.key, request).changed).toEqual([])
    expect(() => repairQuestionGuidance(assignment, key, { ...request, testId: 'other' })).toThrow()
    expect(() => repairQuestionGuidance(assignment, key, { ...request, entries: {} })).toThrow()
    expect(() => repairQuestionGuidance(assignment, key, { ...request, entries: { q: { ...entry, correct: 'different' } } })).toThrow()
  })
  it('keeps sourceEvidence outside all published key projections', () => {
    expect(publishedAnswer({ correct: 'closed-key', ...entry })).toEqual({ correct: 'closed-key', guidance })
  })
})

/** @see ../docs/shared/design/student-review-step.md */
it('validates learner-safe current-step interaction rather than forwarding a hidden key',()=>{
 const base={observation:'В ответе выбрана единица времени.',question:'Какую величину измеряют в этом задании?',source:{title:'Источник',edition:'Издание',section:'Раздел',pages:'1',locator:'1'},presentation:{version:1,activity:{kind:'mark',label:'Твоя запись',instruction:'Выдели нужный фрагмент.',tokens:[{id:'a',text:'минуты'}]}}}
 expect(guidanceErrors(base)).toEqual([])
 base.presentation.activity.tokens[0].correct=true
 expect(guidanceErrors(base).length).toBeGreaterThan(0)
})
