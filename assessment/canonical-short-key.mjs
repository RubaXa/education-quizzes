/** @see ../docs/decisions/concept-short-omission-2026-11-09.md */
import { createHash } from 'node:crypto'

export function correctionFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Add only an already declared canonical short answer; never edit a response.
 * @see ../docs/modules/assessments/quizzes.md#canonical-short-repair
 */
export function canonicalShortKeyRepair(assignment, key, request) {
  if (assignment?.status !== 'submitted' || !assignment.testId
    || request?.testId !== assignment.testId) throw new Error('Submitted test identity required.')
  if (!request.reason?.trim() || !Array.isArray(request.evidenceRefs)
    || !request.evidenceRefs.length || request.evidenceRefs.some((ref) => typeof ref !== 'string' || !ref.trim())) {
    throw new Error('Semantic review reason and evidenceRefs required.')
  }
  const ids = request.questionIds
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) throw new Error('Unique questionIds required.')
  const entries = { ...key?.entries }
  const changed = []
  for (const id of ids) {
    const question = assignment.questions?.find((item) => item.id === id)
    const entry = entries[id]
    if (question?.kind !== 'short' || typeof entry?.correct !== 'string' || !entry.correct.trim()
      || !Array.isArray(entry.accepted) || entry.accepted.some((value) => typeof value !== 'string')) {
      throw new Error(`Canonical short answer and accepted list required: ${id}`)
    }
    // Use exact membership: retaining an existing normalized equivalent is safe,
    // and inserting the exact canonical form is idempotent on subsequent runs.
    if (entry.accepted.includes(entry.correct)) continue
    entries[id] = { ...entry, accepted: [...entry.accepted, entry.correct] }
    changed.push(id)
  }
  return { key: { ...key, entries }, changed }
}

/** An operator may accept one observed omission for a concept-only submitted answer.
 * No fuzzy grading: every case requires its own evidence and unchanged submission.
 * @see ../docs/modules/assessments/quizzes.md#concept-short-omission
 */
export function conceptShortOmissionRepair(assignment, key, request) {
  if (assignment?.status !== 'submitted' || request?.testId !== assignment.testId
    || assignment.assessment?.mode !== 'ordinary' || assignment.assessment?.dictation
    || request?.criterion !== 'concept-only' || request.semanticChecked !== true
    || request.spellingNotAssessed !== true || !request.reason?.trim()
    || !Array.isArray(request.evidenceRefs) || !request.evidenceRefs.length
    || request.evidenceRefs.some(ref => typeof ref !== 'string' || !ref.trim())) {
    throw new Error('Reviewed concept-only submitted identity and evidence required.')
  }
  const question = assignment.questions?.find(q => q.id === request.questionId)
  const entry = key?.entries?.[request.questionId]
  const answer = assignment.answers?.[request.questionId]
  if (question?.kind !== 'short' || typeof answer !== 'string' || answer !== request.observedAnswer
    || typeof entry?.correct !== 'string' || !Array.isArray(entry.accepted)
    || entry.accepted.some(value => typeof value !== 'string')) throw new Error('Exact observed short answer required.')
  const canonical = entry.correct.trim().toLocaleLowerCase('ru')
  const actual = answer.trim().toLocaleLowerCase('ru')
  if (!/^[а-яёa-z]{4,80}$/i.test(canonical) || !/^[а-яёa-z]+$/i.test(actual)
    || actual.length !== canonical.length - 1
    || !Array.from(canonical).some((_, n) => canonical.slice(0,n) + canonical.slice(n+1) === actual)) {
    throw new Error('Only one omitted letter in the canonical word is supported.')
  }
  if (entry.accepted.includes(answer)) return { key, changed: [] }
  return { key: { ...key, entries: { ...key.entries,
    [request.questionId]: { ...entry, accepted: [...entry.accepted, answer] } } }, changed: [request.questionId] }
}
