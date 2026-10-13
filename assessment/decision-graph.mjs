/** Private quiz authoring contract. The plan is never copied into assignments.
 * @see ../docs/product/assessment-decision-graph.md#contract
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
  generic: ['source-fact', 'explanation', 'application'],
})

const nonempty = (value) => typeof value === 'string' && Boolean(value.trim())
const identifiers = (records) => new Set(records.map((record) => record.id))

/** A reviewed, source-linked reading instruction is sufficient to queue a short Education self-check.
 * @see ../docs/product/assessment-decision-graph.md#reading-only */
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

/** A raw MESH keyword can request classification, never authorize publication. */
export function quizDecision(task) {
  if (task?.referenceDate || /(?:^|[^а-яё])цдз(?:$|[^а-яё])/i.test(task?.meshText ?? '')) return null
  const intent = task?.assessmentIntent
  if (intent?.state === 'confirmed' && assessmentModes.includes(intent.mode)
    && nonempty(intent.topic) && nonempty(intent.evidenceRef)) {
    return { job: 'prepare-quiz', mode: intent.mode, evidenceRef: intent.evidenceRef }
  }
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
  const layers = new Set(items.map((item) => item.layer))
  for (const layer of ['current', 'transfer']) if (!layers.has(layer)) errors.push(`Нет слоя ${layer}.`)
  if (!layers.has('spaced') && !nonempty(plan.spacedGapReason)) errors.push('Нет отдельной прежней темы или объяснения её отсутствия.')
  if (!layers.has('prior-gap') && !layers.has('baseline')) errors.push('Нет слоя прежней ошибки или честной входной проверки.')
  if (layers.has('baseline') && !nonempty(plan.historyGapReason)) errors.push('Входная проверка требует historyGapReason.')
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
  if (plan.semanticReview?.completed !== true || !nonempty(plan.semanticReview.ref)) {
    errors.push('Требуется запись независимой смысловой проверки вопросов и допустимых ответов.')
  }
  return errors
}
