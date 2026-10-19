/** Checked feedback contract, separate from answer/explanation/learning.
 * @see ../docs/modules/assessments/quizzes.md#question-guidance
 */
export function guidanceErrors(guidance) {
  const errors = []
  if (!guidance || typeof guidance !== 'object' || Array.isArray(guidance)) return ['Нужен проверенный guidance.']
  for (const field of ['observation', 'question']) {
    if (typeof guidance[field] !== 'string' || guidance[field].trim().length < 15) errors.push(`Нужен конкретный guidance.${field}.`)
  }
  if (Object.keys(guidance).some((key) => !['observation', 'question', 'source'].includes(key))) errors.push('Неизвестные поля guidance запрещены.')
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
    if (!Array.isArray(item.answer?.sourceEvidence) || !item.answer.sourceEvidence.length
      || item.answer.sourceEvidence.some((ref) => typeof ref !== 'string' || !ref.trim())) errors.push(`${item.id}: нужны закрытые sourceEvidence оригинала и проверки.`)
    const text = JSON.stringify([item.answer?.guidance?.observation, item.answer?.guidance?.question])
    if (seen.has(text)) errors.push(`${item.id}: повторяется разбор другого вопроса.`)
    seen.add(text)
  }
  return errors
}

export function repairQuestionGuidance(assignment, key, request) {
  if (!assignment?.testId || request?.testId !== assignment.testId || !request.reason?.trim()) throw new Error('Exact test identity and reason required.')
  const ids = assignment.questions.map((question) => question.id)
  if (!request.entries || Object.keys(request.entries).length !== ids.length || ids.some((id) => !request.entries[id])) throw new Error('Cover every question exactly once.')
  const questions = ids.map((id) => ({ id, answer: request.entries[id] }))
  for (const item of questions) {
    if (Object.keys(item.answer).some((field) => !['guidance', 'sourceEvidence'].includes(field))) throw new Error('Only guidance and sourceEvidence may change.')
    if (!key.entries?.[item.id]) throw new Error(`Missing existing key: ${item.id}`)
  }
  const errors = questionGuidanceErrors(questions)
  if (errors.length) throw new Error(errors.join('\n'))
  const entries = { ...key.entries }, changed = []
  for (const { id, answer } of questions) {
    const updated = { ...entries[id], ...answer }
    if (JSON.stringify(updated) !== JSON.stringify(entries[id])) changed.push(id)
    entries[id] = updated
  }
  return { key: { ...key, entries }, changed }
}
