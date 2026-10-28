/** @see ../docs/decisions/sync-task-routing-2026-10-23.md */
/** A private operator plan, never a pedagogical verdict or student projection.
 * Reuses the assessment graph; no source text is interpreted into invented tasks.
 * @see ../docs/modules/synchronization/task-routing.md
 */
import { quizDecision } from '../assessment/decision-graph.mjs'
import { openMaterialRequest, materialRequestErrors } from '../src/lib/materialRequest.ts'
import { lessonSubjectKey } from '../day/subject-identity.mjs'
const guidancePolicyRevision='parent-readable-hints-2026-10-25'
/** @see ../docs/decisions/guidance-refresh-readback-2026-10-25.md */
const guidanceChecks=['adult-readable-class-level-route-review','learner-current-point-and-safe-hint-review']

const adapters = {
  math: 'math-solution-route', special: 'math-solution-route+teacher-sheet-provenance',
  russian: 'subject-aware-guidance:writing', literature: 'subject-aware-guidance:textual-evidence',
  english: 'subject-aware-guidance:language-in-context', history: 'subject-aware-guidance:source-analysis',
  geography: 'subject-aware-guidance:map-and-source', biology: 'subject-aware-guidance:structure-function',
}
export function missingTaskMaterial(task) {
  if (task?.instructionStatus?.state === 'reviewed' && task.materialRequest?.state === 'resolved'
    && materialRequestErrors(task).length === 0) return false
  return ['textbook-page-needed', 'teacher-attachment-needed'].includes(task?.materialStatus?.state)
    || (task?.materialStatus?.state === 'no-textbook'
      && /отсутств|не получен|нет в библиотек/i.test(task.materialStatus.message ?? ''))
}
export function taskRoute(task = {}, subject = 'generic', { placement = false } = {}) {
  const key = adapters[subject] ? subject : lessonSubjectKey(subject) ?? subject
  const route = { taskId: task.id ?? null, subject: key, adapter: adapters[key] ?? 'subject-aware-guidance:generic',
    known: [], unknown: [], next: null, steps: [], complete: false,
    verification: ['owner-and-revision', 'both-role-readback', 'preserve-attempts-and-optionality'] }
  const select = (next, steps = []) => ({ ...route, next,
    ...(['math','special'].includes(key)&&next==='prepare-written-guidance'?{policyRevision:guidancePolicyRevision}:{}),
    steps: ['math','special'].includes(key)&&next==='prepare-written-guidance'
      ? [...steps.slice(0,2),...guidanceChecks,...steps.slice(2)] : steps })
  if (task.meshText) route.known.push('raw-assignment')
  if (task.instructionStatus?.state === 'reviewed') route.known.push('reviewed-instruction')
  if (task.platformResult?.state === 'completed') return select('platform-result-confirmed', ['preserve-platform-evidence'])
  const request = openMaterialRequest(task)
  if (request) {
    route.known.push('student-material-request')
    route.unknown.push('exact-material')
    return select('await-source-upload', ['source-material-review', 'resolve-request', 'replan-task'])
  }
  if (missingTaskMaterial(task)) {
    route.unknown.push('exact-material')
    return select('recover-source', ['family-source-lookup', 'exact-edition-web-lookup',
      'publish-student-material-request', 'await-source-upload'])
  }
  if (task.sourceOnly || task.instructionStatus?.state !== 'reviewed') {
    route.unknown.push('instruction-scope')
    return select('review-instruction', ['exact-source-review', 'split-confirmed-actions', 'replan-task'])
  }
  if (task.testToken || placement) return select('existing-assessment', ['read-current-attempt', 'audit-key-and-alternatives', 'assessment-decision-graph'])
  const decision = quizDecision(task)
  if (decision) {
    if (decision.job === 'classify-assignment') route.unknown.push('assessment-topic-or-output')
    return select(decision.job, decision.job === 'prepare-quiz'
      ? ['family-source-review', 'learner-history', 'assessment-plan', 'quiz-validate-publish', 'audit-access-and-day-readback']
      : ['confirm-topic-and-output', 'publish-material-request-if-unknown', 'replan-task'])
  }
  if (task.kind === 'written' || task.outputKind === 'written') return select('prepare-written-guidance',
    ['exact-condition-and-criteria', 'private-parent-route', 'safe-student-projection', 'await-work-upload'])
  if (task.kind === 'cdz') return select('await-platform-evidence', ['verify-platform-result-without-requiring-answers'])
  route.unknown.push('applicable-action')
  return select('review-instruction', ['confirm-action-without-inventing-requirements'])
}

/** Existing durable job kinds are preserved. A material request does not close enrichment. */
export function taskRouteCandidates(task = {}) {
  return missingTaskMaterial(task) && !openMaterialRequest(task) ? ['material-needed'] : []
}

export function jobRoute(kind) {
  const routes = {
    'ingest-book': 'identify-and-link-family-material', 'publish-book-pages': 'publish-family-reader-pages',
    'transfer-work': 'confirm-original-storage', 'review-work': 'review-upload-purpose',
    'repair-review': 'reconcile-existing-review', 'investigate-work': 'investigate-exact-upload',
    'triage-help': 'address-help-request', 'triage-olympiad-help': 'address-practice-help-request', 'review-quiz': 'review-submitted-quiz',
    'prepare-targeted-followup': 'history-based-followup', 'prepare-control-followup': 'assessment-decision-graph',
    'classify-assignment': 'confirm-topic-and-output', 'prepare-quiz': 'assessment-decision-graph',
    'enrich-task': 'exact-source-and-subject-guidance', 'material-needed': 'recover-source',
    'reconcile-day': 'source-diff-publish-both-roles',
  }
  return { next: routes[kind] ?? 'unsupported-job', complete: false,
    ...(['enrich-task','triage-help','review-work','repair-review'].includes(kind)
      ? {policyRevision:guidancePolicyRevision,operatorReviewSteps:guidanceChecks}: {}) }
}

export function syncRoutePlan(tasks, jobs) {
  return { schemaVersion: 1, fullCycleRequired: true,
    phases: ['claim-dispatch-if-present', 'fresh-global-inventory-and-inbox', 'fresh-42-day-mesh',
      'frozen-actions-and-changed-or-pending-days', 'both-role-publication-audit', 'fresh-final-inbox', 'report-exact-blockers'],
    tasks, jobs: jobs.map(job => ({ ...job, ...jobRoute(job.kind) })),
    completionClaim: false }
}

export function eventTaskRoute(eventType, inputs = {}) {
  const task = inputs.context?.task
  const subject = lessonSubjectKey(inputs.context?.subject) ?? 'generic'
  const olympiadSheet = task?.sourceIntake?.kind === 'olympiad-sheet' && task?.learningContext?.kind === 'olympiad' && task?.optional === true
  const activeCompetition = Boolean(task?.competitionUntil && Number.isFinite(Date.parse(task.competitionUntil)) && Date.now() <= Date.parse(task.competitionUntil))
  const sourceMaterial = inputs.source?.purpose === 'source-material' || Boolean(task && openMaterialRequest(task))
  const next = activeCompetition && ['upload.confirmed', 'help.requested'].includes(eventType) ? 'hold-competition-solution' : eventType === 'upload.confirmed' ? olympiadSheet ? 'ingest-olympiad-sheet' : sourceMaterial ? 'review-source-material' : 'review-written-work'
    : ({ 'help.requested': 'address-help-request', 'quiz.submitted': 'review-submitted-quiz',
      'quiz.followup_requested': 'history-based-followup', 'material.ready': 'identify-and-link-family-material' })[eventType] ?? 'unsupported-event'
  const route = { eventType, next, subject, adapter: adapters[subject] ?? 'subject-aware-guidance:generic', complete: false,
    steps: next === 'hold-competition-solution' ? ['retain-upload', 'wait-for-competition-close'] : next === 'ingest-olympiad-sheet' ? ['read-confirmed-photos', 'check-competition-assistance-policy', 'identify-and-split-conditions', 'verify-source-and-solution', 'match-existing-tasks', 'publish-family-tasks-and-readback']
      : next === 'review-source-material' ? ['source-analysis-without-grade', 'resolve-request-if-supported', 'replan-task']
      : next === 'review-submitted-quiz' ? ['audit-key-and-alternatives', 'review-open-answers', 'publish-review', 'assessment-decision-graph']
        : next === 'history-based-followup' ? ['quiz-history-full-chain', 'review-open-answers', 'assessment-decision-graph', 'validate-and-publish']
          : next === 'review-written-work' ? ['all-upload-pages', 'exact-condition-and-criteria', 'homework-review', 'publish-review']
            : next === 'address-help-request' ? ['read-request-and-attempt', 'one-addressed-next-step', 'publish-support-revision']
              : next === 'identify-and-link-family-material' ? ['verify-original-and-sha', 'identify-edition-and-coverage', 'family-link-and-reader-readback'] : ['block-unknown-event'],
    verification: ['owner-and-revision', 'addressed-readback', 'trajectory-after-new-evidence'] }
  if(['math','special'].includes(subject)&&['review-written-work','address-help-request'].includes(next)) {
    route.policyRevision=guidancePolicyRevision
    const publication=route.steps.findIndex(step=>step.startsWith('publish'))
    route.steps.splice(publication<0?route.steps.length:publication,0,...guidanceChecks)
  }
  return route
}
