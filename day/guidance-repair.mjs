/** @see ../docs/modules/reviews/subject-aware-guidance.md#data-contract */
/** @see ../docs/decisions/released-stage-parity-2026-10-20.md */
import { projectGuidanceReveal } from './guidance-release.mjs'
import { isDeepStrictEqual } from 'node:util'

/** Build the learner-safe projection for one explicitly selected reveal stage. */
export function revealContentForStage(stage) {
  if (!stage || typeof stage !== 'object') throw new Error('Этап разбора не найден.')
  return projectGuidanceReveal(stage)
}

/** Find one task or numbered problem without guessing when IDs collide. */
export function findGuidanceTarget(source, id) {
  const matches = (source?.subjects ?? []).flatMap((subject) => (subject.tasks ?? []).flatMap((task) => [
    ...(task.id === id && task.parentGuide ? [{ kind: 'task', subject, task, guide: task.parentGuide }] : []),
    ...(task.problems ?? []).filter((problem) => problem.id === id && problem.parentGuide)
      .map((problem) => ({ kind: 'problem', subject, task, problem, guide: problem.parentGuide })),
  ]))
  return matches.length === 1 ? matches[0] : null
}

/** Classify a legacy event without exposing any of its private wording in diagnostics. */
export function planRevealGuidanceRepair({ event, guide, taskId, stageId }) {
  if (!event || !guide || !Array.isArray(guide.stages)) return { status: 'skip', reason: 'missing-release' }
  if (event.level !== 'reveal' || event.taskId !== taskId || event.stageId !== stageId) return { status: 'skip', reason: 'not-selected-release' }
  if (!Number.isInteger(guide.revision) || event.guideRevision !== guide.revision) return { status: 'skip', reason: 'revised-release' }
  const matches = guide.stages.map((stage, index) => ({ stage, index })).filter(({ stage }) => stage.id === stageId)
  if (matches.length !== 1) return { status: 'skip', reason: 'ambiguous-stage' }
  const { stage, index } = matches[0]
  if (event.stageIndex !== index || event.text !== stage.revealPreview) return { status: 'skip', reason: 'release-mismatch' }
  const revealContent = revealContentForStage(stage)
  if (event.revealContent !== undefined) {
    return isDeepStrictEqual(event.revealContent, revealContent)
      ? { status: 'unchanged', revealContent }
      : { status: 'skip', reason: 'already-diverged' }
  }
  return { status: 'repair', revealContent }
}
