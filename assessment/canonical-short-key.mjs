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
