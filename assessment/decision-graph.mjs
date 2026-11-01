/** @see ../docs/decisions/informatics-assessment-2026-11-01.md */
/**
 * @see ../docs/modules/assessments/assessment-source-policy.md
 */
/** Private quiz authoring contract. The plan is never copied into assignments.
 * @see ../docs/modules/assessments/assessment-decision-graph.md#contract
 */
export const assessmentModes = Object.freeze(['ordinary', 'control-diagnostic', 'control-followup', 'targeted-followup'])
export const assessmentLayers = Object.freeze(['current', 'prior-gap', 'baseline', 'spaced', 'transfer'])
export const subjectAdapters = Object.freeze({
  russian: ['reading-comprehension', 'language-analysis', 'spelling', 'writing'],
  literature: ['text-comprehension', 'textual-evidence', 'interpretation', 'oral-reading'],
  math: ['concept', 'model', 'calculation', 'reasoning'],
  history: ['source-fact', 'chronology', 'causation', 'source-analysis'],
  geography: ['source-fact', 'map', 'causation', 'application'],
  biology: ['source-fact', 'structure-function', 'classification', 'application'],
  english: ['reading', 'listening', 'language-in-context', 'production'],
  informatics: ['code-trace', 'condition', 'iteration', 'debugging', 'transfer'],
  generic: ['source-fact', 'explanation', 'application'],
})

const nonempty = (value) => typeof value === 'string' && Boolean(value.trim())
const identifiers = (records) => new Set(records.map((record) => record.id))

/** Select the words for one linked vocabulary dictation. Incorrect and skipped
 * words remain in repair; a delayed full check is a separate phase.
 * @see ../docs/modules/assessments/assessment-decision-graph.md#vocabulary-dictation
 */
export function vocabularyDictationWords({ phase, sourceWordIds, priorWordIds = [], priorResults = [] }) {
  if (!Array.isArray(sourceWordIds) || !sourceWordIds.length
    || sourceWordIds.some((id) => !nonempty(id)) || identifiers(sourceWordIds.map((id) => ({ id }))).size !== sourceWordIds.length) {
    throw new Error('Нужен проверенный список уникальных ID слов.')
  }
  if (!['initial', 'full-repeat', 'repair', 'delayed-full'].includes(phase)) throw new Error('Неизвестная фаза словарного диктанта.')
  if (phase === 'initial') {
    if (priorWordIds.length || priorResults.length) throw new Error('У первого диктанта нет предыдущей попытки.')
    return [...sourceWordIds]
  }
  if (!Array.isArray(priorWordIds) || !priorWordIds.length || !Array.isArray(priorResults)
    || priorResults.length !== priorWordIds.length || new Set(priorWordIds).size !== priorWordIds.length
    || priorWordIds.some((id) => !sourceWordIds.includes(id))) throw new Error('Предыдущий проход слов неполон.')
  const byWord = new Map(priorResults.map((item) => [item.wordId, item.status]))
  if (byWord.size !== priorWordIds.length || priorWordIds.some((id) => !['correct', 'incorrect', 'skipped'].includes(byWord.get(id)))) {
    throw new Error('Каждое слово предыдущего прохода должно быть проверено.')
  }
  if (phase === 'full-repeat' && priorWordIds.length !== sourceWordIds.length) throw new Error('Второй проход требует полного первого списка.')
  return phase === 'repair' ? priorWordIds.filter((id) => byWord.get(id) !== 'correct') : [...sourceWordIds]
}

/** A dictation covers every assigned exercise, not just a word list copied from
 * a short MESH note. Evidence belongs to the exact family material/exercise.
 * @see ../docs/modules/assessments/assessment-decision-graph.md#vocabulary-dictation
 */
export function validateVocabularySourceCoverage(dictation) {
  const assigned = dictation?.assignedMaterialRefs
  const coverage = dictation?.sourceCoverage
  if (!Array.isArray(assigned) || !assigned.length || assigned.some((ref) => !nonempty(ref))
    || new Set(assigned).size !== assigned.length || !Array.isArray(coverage)
    || coverage.length !== assigned.length) return ['Нужны все назначенные упражнения и по одной сверке слов для каждого.']
  const covered = new Set(), words = new Set(), errors = []
  for (const item of coverage) {
    if (!nonempty(item?.ref) || !assigned.includes(item.ref) || covered.has(item.ref)
      || item.verified !== true || !nonempty(item.evidenceRef)
      || !Array.isArray(item.wordIds) || !item.wordIds.length
      || item.wordIds.some((word) => !nonempty(word)) || new Set(item.wordIds).size !== item.wordIds.length) {
      errors.push(`Не подтверждены границы и слова упражнения ${item?.ref ?? '?'}.`)
      continue
    }
    covered.add(item.ref)
    for (const word of item.wordIds) words.add(word)
  }
  if (covered.size !== assigned.length || assigned.some((ref) => !covered.has(ref))) {
    errors.push('Не все назначенные упражнения сверены с точным материалом.')
  }
  const selected = new Set(dictation.sourceWordIds ?? [])
  if (words.size !== selected.size || [...words].some((word) => !selected.has(word))) {
    errors.push('Список диктанта не совпадает с объединением слов назначенных упражнений.')
  }
  return errors
}

/** A reviewed, source-linked reading instruction is sufficient to queue a short Education self-check.
 * @see ../docs/modules/assessments/assessment-decision-graph.md#reading-only */
function isConfirmedReadingOnly(task) {
  if (task?.instructionStatus?.state !== 'reviewed'
    || task?.materialStatus?.state !== 'textbook-page-linked'
    || task?.kind === 'written'
    || (task?.outputKind && task.outputKind !== 'reading')) return false
  const text = task.meshText ?? ''
  const reading = task.kind === 'read'
    || /(?:знаком(?:ься|имся|иться|ьтесь)\s+с\s+текстом|ознаком(?:иться|ься|ьтесь)\s+с\s+(?:текстом|параграфом)|прочит(?:ать|ай|айте)|прочт(?:и|ите)|читать|пересказ(?:ать)?)/i.test(text)
  const otherOutput = /(?:в\s+тетрад[ьи]|дописать|выписать|записать|написать|составить|нарисовать|ответить|выполнить|письменно|\(\s*пис\s*\)|(?:^|\s)упр\.?\s*\d|сдать|загрузить|решить\s+(?:задач|упр)|подготовиться\s+к\s+(?:контрольн|самостоятельн))/i.test(text)
  return reading && !otherOutput
}

/** Content selects the programming adapter even under the school label technology.
 * Recognition only queues source/intent classification; it never invents platform questions.
 * @see ../docs/modules/assessments/assessment-decision-graph.md#informatics */
export function programmingAssignment(task) {
  const text = `${task?.meshText ?? ''} ${task?.assessmentIntent?.topic ?? ''}`
  return /(?:\bpython\b|программирован|листинг|proginf\.ru)/i.test(text)
    && /(?:цикл|услови|программ|python|листинг)/i.test(text)
}

/** A supplementary test is a separate optional activity, not platform-completion evidence.
 * @see ../docs/modules/assessments/assessment-decision-graph.md#informatics */
export function supplementalAssessmentPlacement(task, placements = []) {
  return task?.instructionStatus?.state === 'reviewed' && task?.assessmentIntent?.state === 'confirmed'
    ? placements.find(item => item.relatedTaskId === task.id && item.optional === true && !item.taskId) : undefined
}

/** A raw MESH keyword can request classification, never authorize publication. */
export function quizDecision(task) {
  if (task?.referenceDate || /(?:^|[^а-яё])цдз(?:$|[^а-яё])/i.test(task?.meshText ?? '')) return null
  const intent = task?.assessmentIntent
  if (intent?.state === 'confirmed' && assessmentModes.includes(intent.mode)
    && nonempty(intent.topic) && nonempty(intent.evidenceRef)) {
    return { job: 'prepare-quiz', mode: intent.mode, evidenceRef: intent.evidenceRef }
  }
  if (programmingAssignment(task)) return { job: 'classify-assignment', reason: 'confirm-programming-topic-language-and-platform-scope' }
  if (intent || /подготовиться\s+к\s+контрольн/i.test(task?.meshText ?? '')) {
    return { job: 'classify-assignment', reason: 'confirm-topic-output-and-assessment-mode' }
  }
  if (isConfirmedReadingOnly(task)) {
    return { job: 'prepare-quiz', mode: 'ordinary', evidenceRef: task.source ?? 'reviewed-day-task', readingOnly: true }
  }
  if (task?.instructionStatus?.state === 'reviewed'
    && /(?:§\s*\d|(?:^|[^а-яё])п\.?\s*\d+|читать|прочитать|пересказ|устно|повторить|выучить)/i.test(task.meshText ?? '')) {
    return { job: 'classify-assignment', reason: task.kind === 'written'
      ? 'split-written-and-oral-parts' : 'confirm-oral-output-and-topic' }
  }
  return null
}

export function pendingManualQuestionIds(assignment, review) {
  return (assignment?.questions ?? [])
    .filter((question) => question.kind === 'long')
    .filter((question) => {
      const answer = assignment?.answers?.[question.id]
      return typeof answer === 'string' ? Boolean(answer.trim()) : Array.isArray(answer) && answer.length > 0
    })
    .filter((question) => {
      const entry = review?.entries?.[question.id]
      return !entry || !Number.isFinite(entry.points) || entry.points < 0
        || entry.points > question.points || !nonempty(entry.explanation)
    })
    .map((question) => question.id)
}

/** This is a structural gate. An operator still checks facts, keys and ambiguity. */
export function validateAssessmentPlan(plan, spec) {
  const errors = []
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return ['Нет закрытого assessment plan.']
  if (plan.policyVersion !== 1) errors.push('policyVersion должен быть 1.')
  if (!assessmentModes.includes(plan.mode)) errors.push('Неизвестный mode.')
  if (!Object.hasOwn(subjectAdapters, plan.subjectAdapter)) errors.push('Неизвестный subjectAdapter.')
  const assignment = plan.assignment ?? {}
  if (!nonempty(assignment.evidenceRef) || !nonempty(assignment.topic)
    || !Number.isInteger(assignment.grade) || assignment.grade < 1 || assignment.grade > 11
    || !['oral', 'reading', 'control-prep', 'standalone-practice'].includes(assignment.outputKind)
    || assignment.confirmed !== true) {
    errors.push('Нужно подтверждённое задание: evidenceRef, topic, grade, outputKind, confirmed.')
  }
  if (['control-diagnostic', 'control-followup'].includes(plan.mode) && assignment.outputKind !== 'control-prep') {
    errors.push('Режим контрольной требует подтверждённое outputKind: control-prep.')
  }
  const sources = Array.isArray(plan.sources) ? plan.sources : []
  const evidence = Array.isArray(plan.learnerEvidence) ? plan.learnerEvidence : []
  const objectives = Array.isArray(plan.objectives) ? plan.objectives : []
  const items = Array.isArray(plan.items) ? plan.items : []
  if (!sources.length || !sources.every((source) => nonempty(source.id) && nonempty(source.ref)
    && ['assignment', 'family-material', 'official-scope', 'format-example', 'methodology'].includes(source.role)
    && source.verified === true)) errors.push('Источники должны иметь ID, роль, проверенный ref.')
  if (!sources.some((source) => source.role === 'assignment')) errors.push('Нет источника исходного задания.')
  if (!sources.some((source) => source.role === 'family-material')) errors.push('Нет проверенного семейного материала.')
  if (!sources.some((source) => source.role === 'official-scope')) errors.push('Нет официальной границы содержания.')
  if (!Array.isArray(plan.learnerEvidence) || !evidence.every((item) => nonempty(item.id)
    && nonempty(item.ref) && ['confirmed', 'unknown'].includes(item.state))) {
    errors.push('История ученика должна иметь явные ссылки и степень подтверждения.')
  }
  if (!objectives.length || !objectives.every((objective) => nonempty(objective.id)
    && nonempty(objective.skill) && subjectAdapters[plan.subjectAdapter]?.includes(objective.strand))) {
    errors.push('Цели должны относиться к предметной матрице навыков.')
  }
  if (new Set(sources.map((item) => item.id)).size !== sources.length
    || new Set(objectives.map((item) => item.id)).size !== objectives.length
    || new Set(items.map((item) => item.questionId)).size !== items.length) errors.push('ID в плане должны быть уникальны.')
  const sourceIds = identifiers(sources), evidenceIds = identifiers(evidence), objectiveIds = identifiers(objectives)
  const questionIds = new Set((spec.questions ?? []).map((question) => question.id))
  if (items.length !== questionIds.size || items.some((item) => !questionIds.has(item.questionId))) {
    errors.push('Каждый вопрос теста должен иметь ровно одну запись происхождения в плане.')
  }
  for (const item of items) {
    const question = (spec.questions ?? []).find((candidate) => candidate.id === item.questionId)
    if (!assessmentLayers.includes(item.layer) || !objectiveIds.has(item.objectiveId)
      || !Array.isArray(item.sourceIds) || !item.sourceIds.length
      || item.sourceIds.some((id) => !sourceIds.has(id))
      || !nonempty(item.rationale) || !nonempty(item.criterion)
      || item.keyReviewed !== true || item.format !== question?.kind) {
      errors.push(`Вопрос ${item.questionId ?? '?'}: нет слоя, цели, источника, критерия, формата или проверки ключа.`)
    }
    if (item.layer === 'prior-gap' && (!Array.isArray(item.evidenceIds) || !item.evidenceIds.length
      || item.evidenceIds.some((id) => !evidenceIds.has(id) || evidence.find((entry) => entry.id === id)?.state !== 'confirmed'))) {
      errors.push(`Вопрос ${item.questionId ?? '?'}: подтверждённый пробел не связан с попыткой.`)
    }
    if (item.layer === 'spaced' && (!nonempty(item.topic) || item.topic.trim() === assignment.topic?.trim()
      || !nonempty(item.priorTopicRef))) {
      errors.push(`Вопрос ${item.questionId ?? '?'}: интервальный слой требует отдельную прежнюю тему и её источник.`)
    }
  }
  if (plan.dictation) {
    errors.push(...validateVocabularySourceCoverage(plan.dictation).map((error) => `Словарный диктант: ${error}`))
    try {
      const selected = vocabularyDictationWords(plan.dictation)
      const wordsByQuestion = plan.dictation.wordIdByQuestion ?? {}
      const actual = (spec.questions ?? []).map((question) => wordsByQuestion[question.id])
      if (!nonempty(plan.dictation.sourceRef) || !selected.length || actual.length !== selected.length
        || new Set(actual).size !== actual.length || actual.some((id) => !selected.includes(id))
        || (spec.questions ?? []).some((question) => question.kind !== 'short')
        || (plan.dictation.phase === 'initial' ? Boolean(spec.linkedToTestId) : !spec.linkedToTestId)) {
        errors.push('Словарный диктант: каждый выбранный пункт должен требовать открытого написания одного проверенного слова; повтор связан с прежним тестом.')
      }
    } catch (error) { errors.push(`Словарный диктант: ${error.message}`) }
  }
  const layers = new Set(items.map((item) => item.layer))
  // A linked repair round is a word-level drill continuing the full diagnostic.
  // It may contain just one misspelt word; unrelated questions would defeat it.
  if (plan.dictation?.phase === 'repair') {
    if (items.some((item) => item.layer !== 'prior-gap')) errors.push('Повтор ошибок словарного диктанта должен опираться на подтверждённые неверные слова.')
  } else {
    for (const layer of ['current', 'transfer']) if (!layers.has(layer)) errors.push(`Нет слоя ${layer}.`)
    if (!layers.has('spaced') && !nonempty(plan.spacedGapReason)) errors.push('Нет отдельной прежней темы или объяснения её отсутствия.')
    // A fully checked consolidation may have no historical errors at all.
    // Publication revalidates this strategy against the complete lineage.
    if (!layers.has('prior-gap') && !layers.has('baseline') && plan.continuation?.strategy !== 'consolidation') errors.push('Нет слоя прежней ошибки или честной входной проверки.')
    if (layers.has('baseline') && !nonempty(plan.historyGapReason)) errors.push('Входная проверка требует historyGapReason.')
  }
  if (plan.mode === 'control-diagnostic' && ((spec.questions ?? []).length < 20
    || new Set((spec.questions ?? []).map((question) => question.kind)).size < 2
    || !(spec.questions ?? []).some((question) => ['short', 'long', 'number'].includes(question.kind)))) {
    errors.push('Широкая контрольная: минимум 20 пунктов, разные форматы и свободный ответ.')
  }
  if (['control-followup', 'targeted-followup'].includes(plan.mode) !== Boolean(spec.linkedToTestId)) {
    errors.push('Связанное продолжение требует linkedToTestId; первый тест не должен его иметь.')
  }
  if (plan.subjectAdapter === 'math' && (spec.questions ?? []).some((question) => ['single', 'multiple'].includes(question.kind))
    && !nonempty(plan.mathChoiceApprovedRef)) errors.push('Выбор ответа в математике требует ссылки на прямую просьбу родителя.')
  if (plan.subjectAdapter === 'informatics') {
    if (plan.programming?.language !== 'python' || !nonempty(plan.programming.languageEvidenceRef)
      || !nonempty(plan.programming.executionEvidenceRef)) errors.push('Информатика: нужны подтверждённый Python и проверка конечных примеров интерпретатором.')
    if ((spec.questions ?? []).some(question => !nonempty(question.code))) errors.push('Информатика: каждый вопрос требует видимый листинг.')
    if (!(spec.questions ?? []).some(question => ['short', 'number', 'long'].includes(question.kind))) errors.push('Информатика: нужен самостоятельный ответ, а не только выбор.')
  }
  if (plan.semanticReview?.completed !== true || !nonempty(plan.semanticReview.ref)) {
    errors.push('Требуется запись независимой смысловой проверки вопросов и допустимых ответов.')
  }
  return errors
}
