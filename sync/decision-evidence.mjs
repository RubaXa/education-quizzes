/** Private derived links between existing graphs; never a new source of learner facts.
 * @see ../docs/modules/synchronization/subject-decision-graph.md#trace */
const products = {
  'source-covered-quiz': ['scripts/quiz.mjs', 'src/components/QuizCard.tsx'],
  'current-repetition-quiz-covering-this-part': ['scripts/quiz.mjs', 'src/components/QuizCard.tsx'],
  'skill-covered-independent-diagnostic': ['scripts/quiz.mjs', 'src/components/QuizCard.tsx'],
  'source-covered-spelling-dictation': ['scripts/quiz.mjs', 'src/components/QuizQuestionCard.tsx'],
  'audio-linked-assessment': ['scripts/quiz.mjs', 'src/components/QuizQuestionCard.tsx'],
  'source-linked-written-guide': ['scripts/day.mjs', 'src/components/ParentTaskGuide.tsx'],
  'numbered-problems-and-private-solutions': ['scripts/day.mjs', 'src/components/ProblemTaskCard.tsx'],
  'source-linked-project-route': ['scripts/day.mjs', 'src/components/ParentTaskGuide.tsx'],
  'external-platform-evidence': ['scripts/submissions.mjs', 'src/components/WorkReview.tsx'],
  'speaking-content-and-oral-evidence': ['scripts/submissions.mjs', 'src/components/WorkReview.tsx'],
  'comprehension-quiz-and-separate-oral-evidence': ['scripts/quiz.mjs', 'src/components/QuizCard.tsx'],
  'dated-organisational-action': ['scripts/day.mjs', 'src/DayPage.tsx'],
  'information-without-homework': ['scripts/day.mjs', 'src/components/AssignmentBrief.tsx'],
  'verified-material-purpose': ['scripts/submissions.mjs', 'src/components/AssignmentBrief.tsx'],
}
/** References mean available evidence, never that its semantics have been verified.
 * No Firestore reads; content of guides, keys and family records is not copied. */
export function decisionEvidence(plan, inputs = {}, event = null) {
  const task = inputs.context?.task ?? {}, context = inputs.decisionContext ?? {}
  const facts = [], unknown = []
  const add = (kind, ref, revision = null, scope = task.id ?? null) => {
    const id = `fact-${facts.length + 1}`
    facts.push({ id, kind, ref, scope, revision }); return id
  }
  if (task.meshText) add('assignment', 'inputs.context.task.meshText', task.sourceRevision)
  for (const [i] of (inputs.context?.materialLinks ?? []).entries()) add('material-link', `inputs.context.materialLinks[${i}]`)
  for (const [i] of (inputs.context?.taskPageRefs ?? []).entries()) add('edition-page', `inputs.context.taskPageRefs[${i}]`)
  for (const kind of ['previousReview', 'parentGuide', 'releasedGuidance', 'answerKey']) if (inputs[kind]) add(kind, `inputs.${kind}`, inputs[kind].revision)
  if (inputs.source) add('event-source', 'inputs.source', inputs.source.revision)
  for (const [i, ref] of (context.parentRefs ?? []).entries()) if (typeof ref === 'string' && ref.trim()) add('parent-context', `inputs.decisionContext.parentRefs[${i}]`)
  for (const [i, fact] of (context.learnerFacts ?? []).entries()) {
    // A named skill alone is not evidence. Supplied facts must name their scope and source.
    if (typeof fact?.ref === 'string' && fact.ref.trim() && typeof fact.scope === 'string' && fact.scope.trim())
      add('learner-evidence', `inputs.decisionContext.learnerFacts[${i}]`, fact.revision, fact.scope)
  }
  if (!facts.some(f => f.kind === 'parent-context')) unknown.push({ kind: 'parent-context', reason: 'current-and-recorded-parent-context-not-supplied' })
  if (!facts.some(f => f.kind === 'learner-evidence')) unknown.push({ kind: 'learner-context', reason: 'goals-trajectory-and-misconceptions-not-supplied' })
  if (!task.id) unknown.push({kind:'assignment-context',reason:'containing-day-task-not-supplied'})
  if (!plan.actions.length) unknown.push({kind:'subject-action',reason:'subject-action-not-classified'})
  const decisions = plan.actions.map(action => ({
    actionId: action.partId ?? `${task.id ?? 'unaddressed'}:${action.ruleId}`,
    ruleId: action.ruleId, sourceState: action.sourceState,
    sourceFactIds: facts.filter(f => ['assignment', 'material-link', 'edition-page', 'parent-context'].includes(f.kind)).map(f => f.id),
    requirementRefs: ['docs/modules/reviews/review-criteria-provenance.md', 'docs/modules/synchronization/subject-decision-graph.md#subjects'],
    preservedEvidenceRefs: facts.filter(f => ['previousReview', 'releasedGuidance', 'learner-evidence'].includes(f.kind)).map(f => f.id),
  }))
  const expectedProducts = plan.actions.map((action, i) => ({
    actionId: decisions[i].actionId, productKind: action.product,
    existingPublisher: products[action.product]?.[0] ?? null,
    existingConsumer: products[action.product]?.[1] ?? null,
    existingProductRef:action.existingProductRef ?? null,
    requiredEvidence: ['exact-source-and-all-criteria', 'subject-method-and-product-coverage',
      'actual-consumer-ui-kit-state', 'safe-student-and-private-parent-projections', 'fresh-both-role-readback'],
    state: 'requires-verification',
  }))
  const exactId = inputs.source?.taskId ?? inputs.sourcePath?.split('/').at(-1) ?? task.id ?? null
  const eventProducts = {
    'address-help-request':['addressed-microresponse','scripts/help-response.mjs','src/components/ReviewConversation.tsx'],
    'review-source-material':['source-analysis-and-dependent-replan','scripts/submissions.mjs','src/components/AssignmentBrief.tsx'],
    'review-written-work':['addressed-work-review','scripts/submissions.mjs','src/components/WorkReview.tsx'],
    'review-submitted-quiz':['addressed-quiz-review','scripts/quiz.mjs','src/components/QuizResultCard.tsx'],
    'history-based-followup':['history-linked-followup','scripts/quiz.mjs','src/components/QuizCard.tsx'],
    'identify-and-link-family-material':['identified-family-material','scripts/family-library.mjs','src/components/MaterialReader.tsx'],
    'ingest-olympiad-sheet':['source-linked-family-problems','scripts/day.mjs','src/components/ProblemTaskCard.tsx'],
  }
  const product = eventProducts[event?.next]
  const currentProducts = event ? product ? [{actionId:`${exactId ?? 'unaddressed'}:${event.next}`,productKind:product[0],
    existingPublisher:product[1],existingConsumer:product[2],state:'requires-verification',
    requiredEvidence:['exact-event-and-owner','exact-task-or-problem-and-revision','addressed-publication-and-readback'],
    completionScope:event.next==='address-help-request'?'microresponse-only':'addressed-event-only'}] : [] : expectedProducts
  if (event && !product) unknown.push({kind:'event-product',reason:'unsupported-event-route'})
  return { schemaVersion: 1, boundary: 'private-operator-only',
    owner: inputs.owner ?? null,
    taskId: event ? exactId : task.id ?? null, parentTaskId: task.id ?? null, sourceRevision: task.sourceRevision ?? null,
    facts, unknown, decisions, subjectProducts:expectedProducts, expectedProducts:currentProducts, completionClaim: false,
    knowledgeUpdate: { state: 'requires-observed-response',
      rule: 'attempt-to-skill-evidence-to-hypothesis-to-trajectory; no-mastery-from-upload-or-click' } }
}
