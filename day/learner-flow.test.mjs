import { describe, expect, it } from 'vitest'
import { learnerFlowErrors } from './learner-flow.mjs'
import { sourceOnlyPublicationErrors } from './source-only.mjs'
import { publicPageSubjects } from './public-projection.mjs'
const task = () => ({ id: 'mesh-1', kind: 'check', status: 'unknown', sourceOnly: true,
  meshText: 'упр.5 стр.31, р.т.15–16', detail: 'упр.5 стр.31, р.т.15–16',
  instructionStatus: { state: 'needs-review' }, materialStatus: { state: 'textbook-page-needed', message: 'WB original needed' },
  learnerFlow: { version: 1, scope: 'Только упр.5', meshExcerpt: 'упр.5 стр.31', goal: 'Свой диалог',
    boundary: 'WB15–16 не проверены; помощь не новая обязательная работа.',
    source: { pageId: 'book:31', label: 'SB31 ex5', excerpt: 'Use the menu and the plan.' },
    stages: ['plan', 'check'].map(id => ({ id, title: id, prompt: 'Что нужно собеседнику?', hint: 'Посмотри на схему.', frame: 'Проверь пару реплик.', sourceLabel: 'SB31 ex5' })) } })
describe('scoped learner process support', () => {
  it('retains mixed-source blocker and excludes private guide while publishing supported fragment', () => {
    const t = task()
    expect(learnerFlowErrors(t, ['book:31'])).toEqual([])
    expect(sourceOnlyPublicationErrors(t)).toEqual([])
    const p = publicPageSubjects([{ tasks: [{ ...t, parentGuide: { answer: 'private' } }] }])[0].tasks[0]
    expect(p.learnerFlow).toEqual(t.learnerFlow)
    expect(p.parentGuide).toBeUndefined()
    expect(p).toMatchObject({ sourceOnly: true, status: 'unknown', materialStatus: { state: 'textbook-page-needed' } })
  })
  it('rejects invented scope, unrelated page and hidden keys', () => {
    expect(learnerFlowErrors(task(), ['other:31']).length).toBeGreaterThan(0)
    const t = task(); t.learnerFlow.meshExcerpt = 'упр.7'
    expect(learnerFlowErrors(t).length).toBeGreaterThan(0)
    for (const change of [f => f.answer = 'key', f => f.source.private = 'key', f => f.stages[0].answer = 'key']) {
      const c = task(); change(c.learnerFlow)
      expect(learnerFlowErrors(c).length).toBeGreaterThan(0)
      expect(sourceOnlyPublicationErrors(c).length).toBeGreaterThan(0)
    }
  })
})
