/** @see ../docs/decisions/program-explanation-2026-11-01.md */
/** Checked feedback contract, separate from answer/explanation/learning.
 * @see ../docs/modules/assessments/quizzes.md#question-guidance
 */
import {reviewSupplementErrors} from '../packages/education-presentation/review-content.mjs'
export function guidanceErrors(guidance) {
  const errors = []
  if (!guidance || typeof guidance !== 'object' || Array.isArray(guidance)) return ['Нужен проверенный guidance.']
  const execution = guidance.mode === 'program-explanation'
  for (const field of execution ? ['observation', 'reason'] : ['observation', 'question']) {
    if (typeof guidance[field] !== 'string' || guidance[field].trim().length < 15) errors.push(`Нужен конкретный guidance.${field}.`)
  }
  if (Object.keys(guidance).some((key) => !['mode', 'reason', 'observation', 'question', 'source', 'presentation'].includes(key))) errors.push('Неизвестные поля guidance запрещены.')
  if (guidance.mode !== undefined && !execution) errors.push('Неизвестный режим guidance.')
  if (execution && (guidance.question !== undefined || guidance.presentation?.activity !== undefined
    || guidance.presentation?.visual?.kind !== 'comparison' || !guidance.presentation?.details?.length
    || guidance.observation?.length > 160 || guidance.reason?.length > 160)) errors.push('Разбор программы: короткое правило, причина, таблица выполнения и пояснение; без вопроса и ввода.')
  errors.push(...reviewSupplementErrors(guidance.presentation))
  const source = guidance.source
  for (const field of ['title', 'edition', 'section', 'pages', 'locator']) {
    if (typeof source?.[field] !== 'string' || !source[field].trim()) errors.push(`Нужен точный guidance.source.${field}.`)
  }
  if (source && Object.keys(source).some((key) => !['title', 'edition', 'section', 'pages', 'locator', 'url'].includes(key))) errors.push('Неизвестные поля источника запрещены.')
  if (source?.url !== undefined) {
    try { if (new URL(source.url).protocol !== 'https:') throw new Error() } catch { errors.push('Источник должен иметь HTTPS URL.') }
  }
  const text = `${guidance.observation} ${guidance.question} ${source?.locator}`
  if (/На каком шаге твоя запись|Вернись к материалу, указанному|Сверь этот шаг с назначенным материалом/i.test(text)) errors.push('Общая заглушка не является разбором.')
  return errors
}

export function questionGuidanceErrors(questions) {
  const errors = [], seen = new Set()
  for (const item of questions) {
    errors.push(...guidanceErrors(item.answer?.guidance).map((error) => `${item.id}: ${error}`))
    if(item.answer?.guidance?.mode === 'program-explanation') {
      if(!item.code?.trim())errors.push(`${item.id}: разбор выполнения требует видимый код вопроса.`)
    } else if(!item.answer?.guidance?.presentation?.activity)errors.push(`${item.id}: нужна наглядная опора текущего вопроса presentation.activity без готового ответа.`)
    if (!Array.isArray(item.answer?.sourceEvidence) || !item.answer.sourceEvidence.length
      || item.answer.sourceEvidence.some((ref) => typeof ref !== 'string' || !ref.trim())) errors.push(`${item.id}: нужны закрытые sourceEvidence оригинала и проверки.`)
    const text = JSON.stringify([item.answer?.guidance?.observation, item.answer?.guidance?.question])
    if (seen.has(text)) errors.push(`${item.id}: повторяется разбор другого вопроса.`)
    seen.add(text)
  }
  return errors
}

/** Author evidence is local-only: legacy keys are readable after submission. */
export function publishedAnswer(answer = {}) {
  const { sourceEvidence: _sourceEvidence, ...entry } = answer
  return entry
}

export function repairQuestionGuidance(assignment, key, request) {
  if (!assignment?.testId || request?.testId !== assignment.testId || !request.reason?.trim()) throw new Error('Exact test identity and reason required.')
  const ids = assignment.questions.map((question) => question.id)
  if (!request.entries || Object.keys(request.entries).length !== ids.length || ids.some((id) => !request.entries[id])) throw new Error('Cover every question exactly once.')
  const questions = assignment.questions.map(({id,code}) => ({ id, code, answer: request.entries[id] }))
  for (const item of questions) {
    if (Object.keys(item.answer).some((field) => !['guidance', 'sourceEvidence'].includes(field))) throw new Error('Only guidance and sourceEvidence may change.')
    if (!key.entries?.[item.id]) throw new Error(`Missing existing key: ${item.id}`)
  }
  const errors = questionGuidanceErrors(questions)
  if (errors.length) throw new Error(errors.join('\n'))
  const entries = { ...key.entries }, changed = []
  for (const { id, answer } of questions) {
    const updated = { ...entries[id], guidance: answer.guidance }
    if (JSON.stringify(updated) !== JSON.stringify(entries[id])) changed.push(id)
    entries[id] = updated
  }
  return { key: { ...key, entries }, changed }
}
