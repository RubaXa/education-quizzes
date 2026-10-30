import { describe, expect, it } from 'vitest'
import { nextTutoringBranch, selectTutoringMove, tutoringPlanErrors } from './tutoring-decision.mjs'
import { studentReviewProjection } from './review-projection.mjs'

const review = () => ({ taskId: 'digits', status: 'partial', uploadIds: ['photo'], items: [{ stageId: 'found-example', status: 'correct' }, { stageId: 'all-cases', status: 'partial' }], studentFeedback: {
  confirmed: 'Сумма 12 проверена верно.', focus: 'Одна цифра не охватывает наборы. Сумма нескольких цифр может превышать 9.', question: 'Посчитай сумму двух новых цифр.', steps: [{ stageId: 'all-cases', uploadId: 'photo', location: 'нижняя строка с n', observation: 'n обозначает новую цифру.', explanation: 'Одна цифра и сумма нескольких цифр имеют разные ограничения.', status: 'partial' }], anchor: { uploadId: 'photo' } },
  tutoringPlan: { version: 1, taskId: 'digits', workType: 'proof', sourceRef: 'sheet:page2:problem3', firstGapStageId: 'all-cases', preserveStageIds: ['found-example'],
    evidence: { uploadId: 'photo', location: 'нижняя строка с n', observed: 'Значения больше 9 исключены как не цифры.' },
    acceptedConnection: 'Сумма 12 проверена верно.', gapExplanation: 'Одна цифра не охватывает наборы.',
    bridge: 'Сумма нескольких цифр может превышать 9.', responseCriterion: 'Различены цифра и сумма набора.',
    preserve: 'Не повторять принятый способ с 6.', semanticChecked: true,
    state: { sourceReady: true, attemptState: 'incomplete', gap: 'completeness', prerequisite: 'unknown', unsuccessfulHelp: 0 }, move: 'explain-scope',
    branches: { correct: 'Перейти к наборам и кратности суммы.', partial: 'Разделить итоговую сумму и добавку.', stuck: 'Разобрать аналогию на двух других цифрах.', ambiguous: 'Уточнить, что означает написанное n.' } } })

describe('personal tutoring decision graph', () => {
  it('separates missing source, unreadable evidence, orientation and completion', () => {
    expect(selectTutoringMove({ sourceReady: false })).toBe('request-source')
    for (const [attemptState, move] of [['complete', 'close'], ['unreadable', 'clarify-evidence'], ['not-started', 'orient']]) expect(selectTutoringMove({ sourceReady: true, attemptState })).toBe(move)
  })
  it('uses the observed gap rather than the subject label or score', () => {
    const s = review().tutoringPlan.state
    expect(selectTutoringMove({ ...s, subject: 'math', grade: 2 })).toBe('explain-scope')
    expect(selectTutoringMove({ ...s, subject: 'history', grade: 5 })).toBe('explain-scope')
    expect(selectTutoringMove({ ...s, gap: 'notation' })).toBe('explain-meaning')
    expect(selectTutoringMove({ ...s, gap: 'execution' })).toBe('locate-and-repair')
  })
  it('changes help after an observed failure without treating silence as a failure', () => {
    expect(selectTutoringMove({ ...review().tutoringPlan.state, unsuccessfulHelp: 1 })).toBe('model-small-step')
    expect(selectTutoringMove(review().tutoringPlan.state)).toBe('explain-scope')
    expect(() => nextTutoringBranch(review().tutoringPlan, 'no-response')).toThrow('reply-observation-required')
  })
  it('requires the explanatory bridge in the actual learner text', () => {
    const r = review(); expect(tutoringPlanErrors(r)).toEqual([])
    r.studentFeedback.focus = 'Посмотри, как можно решить лучше.'
    expect(tutoringPlanErrors(r).join()).toContain('видимом тексте')
  })
  it('rejects absent plans and mismatched sources or evidence', () => {
    const r = review(); delete r.tutoringPlan; expect(tutoringPlanErrors(r).length).toBeGreaterThan(0)
    const other = review(); other.tutoringPlan.evidence.uploadId = 'another-child'; expect(tutoringPlanErrors(other).length).toBeGreaterThan(0)
  })
  it('does not rewrite accepted results and uses distinct response branches', () => {
    expect(tutoringPlanErrors({ status: 'verified' }).length).toBeGreaterThan(0)
    const r = review(); expect(nextTutoringBranch(r.tutoringPlan, 'stuck')).toContain('аналогию')
    r.tutoringPlan.branches.partial = r.tutoringPlan.branches.stuck
    expect(tutoringPlanErrors(r).length).toBeGreaterThan(0)
  })
  it('cannot reopen an accepted stage or omit it from preservation', () => {
    const r = review(); r.tutoringPlan.firstGapStageId = 'found-example'
    expect(tutoringPlanErrors(r).length).toBeGreaterThan(0)
    r.tutoringPlan.firstGapStageId = 'all-cases'; r.tutoringPlan.preserveStageIds = []
    expect(tutoringPlanErrors(r).length).toBeGreaterThan(0)
  })
  it('keeps response criteria and all future branches out of learner current state and history', () => {
    const r = review(), result = studentReviewProjection({ ...r, history: [r] })
    expect(result.studentFeedback.focus).toContain(r.tutoringPlan.bridge)
    expect(result).not.toHaveProperty('tutoringPlan')
    expect(result.history[0]).not.toHaveProperty('tutoringPlan')
    expect(JSON.stringify(result)).not.toContain(r.tutoringPlan.responseCriterion)
    expect(JSON.stringify(result)).not.toContain(r.tutoringPlan.branches.stuck)
  })
})

it('accepts a complete explained attempt without inventing another gap or task', () => {
 const r=review();r.status='verified';r.items.forEach(item=>{item.status='correct'});r.studentFeedback.steps[0].status='correct';r.tutoringPlan.firstGapStageId=null;r.tutoringPlan.preserveStageIds=['all-cases','found-example'];r.tutoringPlan.state.attemptState='complete';r.tutoringPlan.move='close';delete r.tutoringPlan.branches
 expect(tutoringPlanErrors(r)).toEqual([])
})
it('rejects a generic receipt even when the verdict is verified', () => {
 const r=review();r.studentFeedback.steps=[]
 expect(tutoringPlanErrors(r).length).toBeGreaterThan(0)
})
