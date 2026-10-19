import { describe, expect, it } from 'vitest'
import { findGuidanceTarget, planRevealGuidanceRepair, revealContentForStage } from './guidance-repair.mjs'

const stage = {
  id: 'solution', title: 'Решение', expected: '12', why: 'Складываем части.', role: 'answer', answer: '12',
  rows: [{ label: 'Сумма', value: '12', explanation: 'После вычисления.' }],
  source: { kind: 'textbook', label: 'Учебник, с. 12', ref: 'private-ref', excerpt: 'private excerpt' },
  hintPreview: 'Подумай.', revealPreview: 'Полный шаг.', verification: [{ value: 'private' }], reviewLabels: ['private'],
}
const guide = { revision: 4, stages: [stage] }
const event = { taskId: 'mesh-task', stageId: 'solution', stageIndex: 0, guideRevision: 4, level: 'reveal', text: stage.revealPreview }

describe('legacy reveal repair planner', () => {
  it('resolves one approved guide whether it belongs to a task or a numbered problem', () => {
    const problem = { id: 'problem-2', parentGuide: guide }
    const source = { subjects: [{ id: 'math', tasks: [{ id: 'mesh-task', problems: [problem] }] }] }
    expect(findGuidanceTarget(source, 'problem-2')).toMatchObject({ kind: 'problem', problem, guide })
    expect(findGuidanceTarget(source, 'mesh-task')).toBeNull()
    expect(findGuidanceTarget({ subjects: [{ tasks: [{ id: 'problem-2', parentGuide: guide }] }, { tasks: [{
      id: 'mesh-other', problems: [{ id: 'problem-2', parentGuide: guide }],
    }] }] }, 'problem-2')).toBeNull()
  })

  it('projects only the selected stage fields and strips private source details', () => {
    expect(revealContentForStage(stage)).toEqual({
      title: 'Решение', expected: '12', rows: [{ label: 'Сумма', value: '12', explanation: 'После вычисления.' }],
      role: 'answer', why: 'Складываем части.', answer: '12',
      verification: [{ value: 'private' }], sourceLabel: 'Учебник, с. 12',
    })
    expect(JSON.stringify(revealContentForStage(stage))).not.toMatch(/private-ref|private excerpt|reviewLabels|hintPreview/)
  })

  it('does not release an answer or verification from a non-answer stage', () => {
    expect(revealContentForStage({ ...stage, role: 'given' })).toMatchObject({ answer: '', verification: [] })
  })

  it('repairs only an exact existing reveal matching stage, index, revision, and saved wording', () => {
    expect(planRevealGuidanceRepair({ event, guide, taskId: 'mesh-task', stageId: 'solution' }).status).toBe('repair')
  })

  it.each([
    [{ ...event, level: 'hint' }, guide, 'not-selected-release'],
    [{ ...event, guideRevision: 3 }, guide, 'revised-release'],
    [{ ...event, stageIndex: 1 }, guide, 'release-mismatch'],
    [{ ...event, text: 'different' }, guide, 'release-mismatch'],
    [event, { ...guide, stages: [stage, { ...stage }] }, 'ambiguous-stage'],
  ])('skips non-exact or ambiguous releases', (candidate, candidateGuide, reason) => {
    expect(planRevealGuidanceRepair({ event: candidate, guide: candidateGuide, taskId: 'mesh-task', stageId: 'solution' })).toEqual({ status: 'skip', reason })
  })

  it('does not overwrite a divergent prior projection and is idempotent after a repair', () => {
    const planned = planRevealGuidanceRepair({ event, guide, taskId: 'mesh-task', stageId: 'solution' })
    expect(planRevealGuidanceRepair({ event: { ...event, revealContent: planned.revealContent }, guide, taskId: 'mesh-task', stageId: 'solution' }).status).toBe('unchanged')
    const reordered = Object.fromEntries(Object.entries(planned.revealContent).reverse())
    reordered.rows = [Object.fromEntries(Object.entries(reordered.rows[0]).reverse())]
    expect(planRevealGuidanceRepair({ event: { ...event, revealContent: reordered }, guide, taskId: 'mesh-task', stageId: 'solution' }).status).toBe('unchanged')
    expect(planRevealGuidanceRepair({ event: { ...event, revealContent: { title: 'old' } }, guide, taskId: 'mesh-task', stageId: 'solution' })).toEqual({ status: 'skip', reason: 'already-diverged' })
  })
})
