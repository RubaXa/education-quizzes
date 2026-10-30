/** @see ../docs/modules/reviews/subject-aware-guidance.md#tutor-decision
 * @see ../docs/decisions/personal-tutoring-2026-10-30.md */
const gaps = new Set(['notation', 'execution', 'concept', 'strategy', 'completeness', 'recall'])
const workTypes = new Set(['calculation', 'proof', 'construction', 'reading', 'retelling', 'composition', 'language-use', 'factual-explanation'])

/** Route an observed learning state, never diagnose an ability from a grade. */
export function selectTutoringMove(state) {
  if (!state?.sourceReady) return 'request-source'
  if (state.attemptState === 'complete') return 'close'
  if (state.attemptState === 'unreadable') return 'clarify-evidence'
  if (state.attemptState === 'not-started') return 'orient'
  if (!gaps.has(state.gap)) throw new Error('unknown-tutoring-gap')
  if (state.unsuccessfulHelp > 0 || state.prerequisite === 'not-demonstrated') return 'model-small-step'
  return { notation: 'explain-meaning', execution: 'locate-and-repair', concept: 'contrast-example',
    strategy: 'model-small-step', completeness: 'explain-scope', recall: 'teach-and-apply' }[state.gap]
}

/** The author supplies task-specific branches. A classifier/operator must observe the reply first. */
export function nextTutoringBranch(plan, observedReply) {
  if (!['correct', 'partial', 'stuck', 'ambiguous'].includes(observedReply)) throw new Error('reply-observation-required')
  return plan.branches[observedReply]
}

/** Structural gate, not a claim that a machine has proved the pedagogy or mathematical truth. */
export function tutoringPlanErrors(review) {
  if (review.purpose === 'source-material' || !review.status) return []
  const p = review.tutoringPlan, f = review.studentFeedback
  if (!p || p.version !== 1 || p.taskId !== review.taskId || !workTypes.has(p.workType)) return ['Нужен адресный tutoringPlan с видом работы и taskId.']
  const acceptedStages = (review.items ?? []).filter(item => item.status === 'correct' && item.stageId).map(item => item.stageId).sort()
  const gapStage = review.items?.find(item => item.stageId === p.firstGapStageId)
  const complete = review.status === 'verified'
  if ((complete ? p.firstGapStageId != null : !gapStage || gapStage.status === 'correct') || !Array.isArray(p.preserveStageIds)
    || JSON.stringify([...p.preserveStageIds].sort()) !== JSON.stringify(acceptedStages)) return ['Первый пробел должен относиться к незачтённому этапу; все зачтённые этапы сохраняются отдельно.']
  const text = value => typeof value === 'string' && value.trim().length >= 12
  if (!text(p.sourceRef) || !text(p.evidence?.observed) || !text(p.evidence?.location)
    || !review.uploadIds?.includes(p.evidence?.uploadId) || !text(p.acceptedConnection)
    || !text(p.gapExplanation) || !text(p.bridge) || !text(p.responseCriterion)) return ['План репетитора требует источник, место работы, принятую связь, объяснение перехода и критерий ответа.']
  if (!p.state || (complete ? p.state.attemptState !== 'complete' || p.state.sourceReady !== true
    : !['incomplete', 'unreadable'].includes(p.state.attemptState)) || !gaps.has(p.state.gap)
    || !Number.isInteger(p.state.unsuccessfulHelp) || p.state.unsuccessfulHelp < 0
    || !['demonstrated', 'not-demonstrated', 'unknown'].includes(p.state.prerequisite)
    || selectTutoringMove(p.state) !== p.move) return ['Выбранная помощь не соответствует подтверждённому состоянию шага.']
  if (!f?.confirmed?.includes(p.acceptedConnection) || !f?.focus?.includes(p.gapExplanation)
    || !f?.focus?.includes(p.bridge) || !text(f?.question)
    || f.anchor?.uploadId !== p.evidence.uploadId) return ['Объясняющий переход должен быть в видимом тексте, а не только в закрытом плане.']
  if ((!complete && (!p.branches || !['correct', 'partial', 'stuck', 'ambiguous'].every(key => text(p.branches[key]))
    || new Set(Object.values(p.branches)).size !== 4)) || !text(p.preserve)) return ['Нужны четыре разные адресные ветки ответа и граница уже зачтённого.']
  if (!Array.isArray(f.steps) || !f.steps.length || f.steps.length > 20 || f.steps.some(step =>
    !review.items?.some(item => item.stageId === step.stageId && item.status === step.status)
    || !review.uploadIds.includes(step.uploadId) || !text(step.location) || !text(step.observation) || !text(step.explanation))) return ['Каждой новой работе нужен объяснённый шаг с точным местом в текущем фото; новый ключ и постороннее фото запрещены.']
  if (p.humanChecked !== true) return ['Нужна смысловая проверка плана: точность, понятность, один посильный шаг и отсутствие выдачи ответа.']
  return []
}
