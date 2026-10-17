/** Shared card decision graph. A subject suggests an adapter; the verified output
 * decides which one applies. No subject name alone creates a solution or a duty.
 * @see ../docs/modules/reviews/card-generation-policy.md#decision-graph */
export const mathRouteProfiles = Object.freeze({
  compact: Object.freeze(['solution', 'answer']),
  standard: Object.freeze(['given', 'solution', 'answer']),
  extended: Object.freeze(['given', 'relations', 'calculation', 'answer']),
})

/** Stable stage IDs are shared by generation, validation and the parent renderer.
 * The LLM fills sourced text; it cannot change the shape of a published pattern.
 * @see ../docs/modules/reviews/card-generation-policy.md#russian-adapter */
export const languageRoutePatterns = Object.freeze({
  spelling: Object.freeze({ kind: 'structured-notes', stages: Object.freeze(['rule', 'application', 'writing']) }),
  syntax: Object.freeze({ kind: 'structured-notes', stages: Object.freeze(['basis', 'relations', 'analysis']) }),
  'text-plan': Object.freeze({ kind: 'text-structure', stages: Object.freeze(['theme', 'speech', 'plan']) }),
  composition: Object.freeze({ kind: 'text-structure', stages: Object.freeze(['idea', 'support', 'coherence', 'language']) }),
})

/** Subject-specific routes are configurations of the same private guide and public task shell.
 * A repeatable route keeps one stage per sourced item (for example tissue → function).
 * @see ../docs/modules/reviews/card-generation-policy.md#subject-adapters */
export const learningRoutePatterns = Object.freeze({
  ...languageRoutePatterns,
  'short-interpretation': Object.freeze({ subject: 'literature', kind: 'text-structure', stages: Object.freeze(['theme', 'idea']) }),
  'evidence-response': Object.freeze({ subject: 'literature', kind: 'text-structure', stages: Object.freeze(['claim', 'evidence', 'link', 'conclusion']) }),
  'concept-function': Object.freeze({ subject: 'biology', kind: 'structured-notes', repeatable: true }),
  'vocabulary-list': Object.freeze({ subject: 'english', kind: 'structured-notes', repeatable: true }),
  'written-exercise': Object.freeze({ subject: 'english', kind: 'structured-notes', repeatable: true }),
  'source-analysis': Object.freeze({ subject: 'history', kind: 'text-structure', stages: Object.freeze(['origin', 'claim', 'evidence', 'limit']) }),
  'map-analysis': Object.freeze({ subject: 'geography', kind: 'text-structure', stages: Object.freeze(['question', 'source', 'observation', 'conclusion']) }),
  'source-evidence': Object.freeze({ subject: '*', kind: 'structured-notes', stages: Object.freeze(['assignment', 'evidence']) }),
  'source-units': Object.freeze({ subject: '*', kind: 'structured-notes', assignedUnits: true }),
})

/** Each separately assigned numbered exercise is its own required review result.
 * Additional textbook instructions do not become stages. @see ../docs/modules/reviews/review-criteria-provenance.md#assigned-units */
function assignedUnitStageIds(task) {
  const steps = task?.steps
  if (!Array.isArray(steps) || steps.length < 2) return []
  const numbers = steps.map((step) => /^В упр\.\s*(\d+)\b/u.exec(step?.text ?? '')?.[1])
  if (numbers.some((number) => !number) || new Set(numbers).size !== numbers.length) return []
  return numbers.map((number) => `mesh-${number}`)
}

export function validLearningRoute(subjectId, task, guide) {
  const pattern = learningRoutePatterns[task?.cardPattern]
  const stages = guide?.stages
  return Boolean(pattern && (!pattern.subject ? subjectId === 'russian' : pattern.subject === '*' || pattern.subject === subjectId)
    && task.cardPolicyVersion === 1 && guide?.presentation === 'learning-route'
    && guide.pattern === task.cardPattern && guide.kind === pattern.kind && task.outputKind === pattern.kind
    && Number.isInteger(guide.revision) && guide.revision >= 1
    && Array.isArray(stages) && stages.length > 0 && stages.length <= 24
    && (pattern.assignedUnits ? assignedUnitStageIds(task).length === stages.length
        && stages.map((stage) => stage.id).join(',') === assignedUnitStageIds(task).join(',')
      : pattern.repeatable ? new Set(stages.map((stage) => stage.id)).size === stages.length
      : stages.map((stage) => stage.id).join(',') === pattern.stages.join(','))
    && stages.every((stage) => stage.expected?.trim() && stage.hintPreview?.trim() && stage.revealPreview?.trim()
      && Array.isArray(stage.reviewLabels) && stage.reviewLabels.length
      && stage.reviewLabels.every((label) => typeof label === 'string' && label.trim())))
}

export function validLanguageRoute(task, guide) {
  return validLearningRoute('russian', task, guide)
}

export function mathRouteProfile(guide) {
  // Existing approved four-stage guides have no explicit profile.
  return guide?.routeProfile ?? 'extended'
}

/** A reviewed numbered math sheet is a set of separate solutions, including legacy sheets.
 * @see ../docs/modules/reviews/math-solution-route.md#selection */
export function missingMathRoutes(subjectId, task) {
  if (!['math', 'special'].includes(subjectId) || task?.kind !== 'written' && !task?.practiceVariants?.length
    || task?.instructionStatus?.state !== 'reviewed' || !Array.isArray(task?.problems)) return []
  return task.problems.filter((problem) => problem.parentGuide?.kind !== 'worked-solution'
    || problem.parentGuide?.presentation !== 'math-route').map((problem) => problem.id)
}

/** A practice plan groups source problems without inventing extra MESH entries.
 * @see ../docs/modules/reviews/card-generation-policy.md#practice-variants */
export function practiceVariantErrors(task) {
  if (!task?.practiceVariants) return []
  const variants = task.practiceVariants
  if (!Array.isArray(variants) || variants.length < 2 || !Array.isArray(task.problems)) return ['Практика требует вариантов и пунктов.']
  const ids = new Set()
  const errors = []
  for (const variant of variants) {
    if (variant.optionalByTeacher && (!variant.optionalByTeacher.sourceRef?.trim() || !variant.optionalByTeacher.excerpt?.trim())) errors.push('Выбор учителя требует точную ссылку на источник и цитату.')
    if (typeof variant.id !== 'string' || !new RegExp(`^${task.id}-v[1-9][0-9]*$`).test(variant.id)
      || ids.has(variant.id) || !variant.title?.trim()) errors.push('У варианта нужен устойчивый ID и заголовок.')
    ids.add(variant.id)
    if (!task.problems.some((problem) => problem.variantId === variant.id)) errors.push(`У ${variant.id} нет заданий.`)
  }
  const numbers = new Set()
  for (const problem of task.problems) {
    if (!ids.has(problem.variantId)) errors.push(`Пункт ${problem.id} не связан с вариантом.`)
    const pair = `${problem.variantId}:${problem.number}`
    if (numbers.has(pair)) errors.push(`Номер ${pair} повторён внутри варианта.`)
    numbers.add(pair)
  }
  return errors
}

/** Independently inspected teacher-sheet inventory, checked against the card.
 * The operator records this from the full original before entering problem cards.
 * @see ../docs/modules/reviews/card-generation-policy.md#source-inventory */
export function sourceInventoryErrors(task, links = []) {
  const teacherLinks = links.filter((link) => link.sourceType === 'teacher-attachment')
  if (task?.mathRoutePolicyVersion !== 2 || task?.instructionStatus?.state !== 'reviewed') return []
  if (!teacherLinks.length) return task.materialStatus?.state === 'teacher-attachment-needed'
    || /(?:из|в|к)\s+файл[ауе]|лист[ауе]?\s+учителя/i.test(task.meshText ?? '')
    ? ['Для сверенного задания нужен назначенный ему файл учителя.'] : []
  const inventory = task.sourceInventory
  if (!inventory || !Array.isArray(inventory.sources) || inventory.sources.length !== teacherLinks.length) {
    return ['Нужна отдельная опись каждого файла учителя.']
  }
  const seenSources = new Set()
  const groups = []
  for (const sheet of inventory.sources) {
    const link = teacherLinks.find((item) => item.sourceRef === sheet.sourceRef && item.sourceSha256 === sheet.sourceSha256)
    if (!link || seenSources.has(sheet.sourceRef) || !sheet.evidenceRef?.trim()
      || !/^[a-f0-9]{64}$/.test(sheet.sourceSha256 ?? '')) {
      return ['Нужна независимая сверка каждого полного оригинала с его хэшем и записью проверки.']
    }
    seenSources.add(sheet.sourceRef)
    if (!Array.isArray(sheet.groups) || (!sheet.groups.length && !sheet.noNumberedProblemsReason?.trim())) {
      return ['В описи каждого файла нужны группы номеров или явная причина их отсутствия.']
    }
    groups.push(...sheet.groups)
  }
  if (!groups.length) return task.problems?.length || task.practiceVariants?.length
    ? ['Карточка содержит номера или варианты, которых нет в описи оригиналов.'] : []
  if (inventory.resultMode === 'written' && (task.kind !== 'written' || task.outputKind !== 'worked-solution')
    || inventory.resultMode === 'optional-practice' && (task.kind !== 'check' || !task.practiceVariants?.length)
    || !['written', 'optional-practice'].includes(inventory.resultMode)) {
    return ['Вид работы и действие загрузки не совпадают с описью оригинала.']
  }
  const inventoryPairs = []
  for (const group of groups) {
    if (!Array.isArray(group.numbers) || !group.numbers.length
      || group.numbers.some((number) => !Number.isInteger(number) || number < 1)) {
      return ['В каждой группе описи нужны положительные номера задач.']
    }
    inventoryPairs.push(...group.numbers.map((number) => `${group.variantId ?? ''}:${number}`))
  }
  if (new Set(inventoryPairs).size !== inventoryPairs.length) return ['В описи повторён номер внутри одного варианта.']
  const expectedVariantIds = new Set((task.practiceVariants ?? []).map((variant) => variant.id))
  const inventoryVariantIds = new Set(groups.map((group) => group.variantId ?? ''))
  if (expectedVariantIds.size
    ? expectedVariantIds.size !== inventoryVariantIds.size || [...expectedVariantIds].some((id) => !inventoryVariantIds.has(id))
    : inventoryVariantIds.size !== 1 || !inventoryVariantIds.has('')) {
    return ['Варианты карточки не совпадают с независимо сверенным листом.']
  }
  const actualPairs = (task.problems ?? []).map((problem) => `${problem.variantId ?? ''}:${problem.number}`)
  if (inventoryPairs.length !== actualPairs.length || inventoryPairs.some((pair) => !actualPairs.includes(pair))) {
    return ['Номера карточки не совпадают с независимо сверенным листом.']
  }
  return []
}

export function cardAdapter(subjectId, task) {
  if (task?.instructionStatus?.state === 'needs-review') return 'raw-mesh'
  if (task?.cardPattern) {
    return learningRoutePatterns[task.cardPattern] && (learningRoutePatterns[task.cardPattern].subject === subjectId
      || learningRoutePatterns[task.cardPattern].subject === '*' || !learningRoutePatterns[task.cardPattern].subject && subjectId === 'russian')
      ? 'language-route' : 'unsupported-pattern'
  }
  if (task?.outputKind === 'platform-result') return 'platform-result'
  if (task?.outputKind === 'reading') return 'reading'
  if (task?.outputKind === 'evidence-only') return 'evidence-only'
  if (task?.outputKind === 'structured-notes') return 'structured-notes'
  if (task?.outputKind === 'text-structure') return 'text-structure'
  if (task?.outputKind === 'worked-solution') return ['math', 'special'].includes(subjectId) ? 'math-solution' : 'unsupported-solution'
  // Historical numbered sheets have already been reviewed as math solutions.
  if ((task?.kind === 'written' || task?.practiceVariants?.length) && task?.problems?.length && ['math', 'special'].includes(subjectId)) return 'math-solution'
  return 'unclassified'
}

/** Compose shared, result-specific and assignment-specific requirements.
 * A family/school overlay must be added with explicit applicability later.
 * @see ../docs/modules/reviews/special-course-card-overlay.md#teacher-sheet */
export function cardPolicyModules(subjectId, task) {
  const adapter = cardAdapter(subjectId, task)
  return {
    base: 'assignment-card',
    adapter,
    overlays: subjectId === 'special' && (adapter === 'math-solution' || adapter === 'unclassified')
      ? ['special-course-teacher-sheet'] : [],
  }
}
