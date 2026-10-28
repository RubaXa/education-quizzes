/** @see ../../../docs/product/olympiad-preparation.md */
/** The caller supplies a verified provenance and rule projection; unknown must not imply permission.
 * @see ../../../docs/modules/assessments/olympiad-preparation.md#назначение-и-границы
 * @see ../../../docs/decisions/olympiad-domain-ldd-2026-10-27.md */
export type AssistanceContext =
  | { kind: 'practice'; independentlyAuthored: boolean }
  | { kind: 'archive'; competitionClosed: boolean; trainingUseVerified: boolean }
  | { kind: 'competition'; phase: 'active' | 'finished' | 'unknown'; aiRule: 'allowed' | 'prohibited' | 'unknown' }
  | { kind: 'unknown' }
export type AssistanceDecision = { allowed: boolean; reason: 'training' | 'organizer-permits' | 'ai-prohibited' | 'unverified' }

export function evaluateAssistance(context: AssistanceContext): AssistanceDecision {
  if (context.kind === 'practice') return context.independentlyAuthored ? { allowed: true, reason: 'training' } : { allowed: false, reason: 'unverified' }
  if (context.kind === 'archive') return context.competitionClosed && context.trainingUseVerified ? { allowed: true, reason: 'training' } : { allowed: false, reason: 'unverified' }
  if (context.kind !== 'competition' || context.phase === 'unknown' || context.aiRule === 'unknown') return { allowed: false, reason: 'unverified' }
  if (context.phase === 'active' && context.aiRule === 'prohibited') return { allowed: false, reason: 'ai-prohibited' }
  if (context.phase === 'active' && context.aiRule === 'allowed') return { allowed: true, reason: 'organizer-permits' }
  // A completed competition can still have active source restrictions; this module does not infer them.
  return { allowed: false, reason: 'unverified' }
}
