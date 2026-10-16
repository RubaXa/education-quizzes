/** Private, deterministic history of linked attempts. Never publish raw answers.
 * @see ../docs/modules/assessments/assessment-decision-graph.md#followup-threshold */
import { grade, summarize } from '../src/lib/quiz.ts'
import { followupQuestionCount, needsQuizFollowup } from '../src/lib/quizCompletion.ts'
import { createHash } from 'node:crypto'

const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value
const missed = (item) => ['partial', 'incorrect'].includes(item.outcome)

/** Queue discovery does not reread ancestors. The publishing CLI checks them once. */
export function followupQueueSource(assignment, answerKey, review) {
  if (assignment?.status !== 'submitted' || !answerKey?.entries) return null
  const results = grade(assignment, answerKey, review), score = summarize(results)
  if (score.pending || !needsQuizFollowup({ points: score.earned, maxPoints: score.possible }, Boolean(assignment.followupRequestedAt))) return null
  return { type: 'quiz', testId: assignment.testId, originalCount: assignment.questions.length,
    errorCount: results.filter((result) => !result.skipped && result.points < result.question.points).length,
    historyRequired: true, targetCount: null,
    trigger: assignment.followupRequestedAt ? 'parent-request' : 'below-threshold' }
}

/** Exact topic labels are evidence groups, not an invented semantic diagnosis.
 * Both automatic and requested continuations use these same slots. */
export function continuationPlan(history, historyFingerprint, coverageCount = 0) {
  if (!Number.isSafeInteger(coverageCount) || coverageCount < 0) throw new Error('Неверное число целей матрицы темы.')
  const current = history[0], root = history.at(-1)
  const errors = current.items.filter(missed)
  const groups = new Map()
  for (const [recency, attempt] of history.entries()) for (const item of attempt.items.filter(missed)) {
    const key = item.topic === 'Тема не указана' ? `${attempt.testId}/${item.questionId}` : item.topic
    const group = groups.get(key) ?? { sourceTestId: attempt.testId, sourceQuestionId: item.questionId, topic: item.topic, misses: 0, recency }
    group.misses++; groups.set(key, group)
  }
  const weaknesses = [...groups.values()].sort((a, b) => b.misses - a.misses || a.recency - b.recency
    || (a.sourceTestId + '/' + a.sourceQuestionId).localeCompare(b.sourceTestId + '/' + b.sourceQuestionId, 'en'))
  const slots = []
  const add = (role, source) => slots.push({ slotId: `slot-${slots.length + 1}`, role, ...source })
  const strategy = errors.length ? 'repair' : 'consolidation'
  const targetCount = errors.length ? followupQuestionCount(current.questionCount, errors.length)
    : Math.max(root.questionCount, coverageCount) + Math.min(3, weaknesses.length) + 2
  const direct = strategy === 'repair' ? errors : root.items
  for (const item of direct) add(strategy === 'repair' ? 'current-error' : 'topic-coverage', {
    sourceTestId: strategy === 'repair' ? current.testId : root.testId, sourceQuestionId: item.questionId, topic: item.topic })
  if (strategy === 'consolidation') while (slots.length < Math.max(root.questionCount, coverageCount)) add('topic-coverage', {})
  const reinforcement = strategy === 'repair' ? Math.min(6, Math.ceil(errors.length * .3)) : Math.min(3, weaknesses.length)
  for (let i = 0; i < reinforcement; i++) {
    const source = weaknesses[i % weaknesses.length]
    add('historical-error', { sourceTestId: source.sourceTestId, sourceQuestionId: source.sourceQuestionId, topic: source.topic })
  }
  // One separate past topic and one new context are never replaced by a score.
  add('spaced', {}); add('transfer', {})
  const strong = history.flatMap((attempt) => attempt.items.filter((item) => item.outcome === 'correct')
    .map((item) => ({ sourceTestId: attempt.testId, sourceQuestionId: item.questionId, topic: item.topic })))
  let index = 0
  while (slots.length < targetCount) add(strong.length ? 'maintenance' : 'baseline', strong.length ? strong[index++ % strong.length] : {})
  return { policyVersion: 1, sourceTestId: current.testId, historyFingerprint, strategy,
    errorQuestionIds: errors.map((item) => item.questionId), targetCount, slots }
}

export function quizLineageStatistics(attempts, coverageCount = 0) {
  if (!Array.isArray(attempts) || !attempts.length) throw new Error('Нужна хотя бы одна попытка.')
  const topics = new Map()
  const history = attempts.map(({ assignment, answerKey, review }) => {
    if (assignment?.status !== 'submitted' || !answerKey?.entries) throw new Error('История содержит непроверенную попытку.')
    const results = grade(assignment, answerKey, review)
    const score = summarize(results)
    if (score.pending || !score.possible) throw new Error('История содержит непроверенные свободные ответы или пустой результат.')
    const items = results.map((result) => {
      const topic = result.question.topic?.trim() || 'Тема не указана'
      const outcome = result.skipped ? 'skipped' : result.points === result.question.points ? 'correct'
        : result.points > 0 ? 'partial' : 'incorrect'
      const record = topics.get(topic) ?? { topic, correct: 0, partial: 0, incorrect: 0, skipped: 0 }
      record[outcome]++
      topics.set(topic, record)
      return { questionId: result.question.id, topic, kind: result.question.kind, outcome,
        points: result.points, possible: result.question.points,
        selectedOptionIds: ['single', 'multiple', 'figure'].includes(result.question.kind)
          ? result.answer ?? null : null }
    })
    return { testId: assignment.testId, linkedToTestId: assignment.linkedToTestId ?? null,
      questionCount: items.length, earned: score.earned, possible: score.possible,
      incorrectQuestionIds: items.filter((item) => item.outcome === 'incorrect' || item.outcome === 'partial').map((item) => item.questionId),
      correctQuestionIds: items.filter((item) => item.outcome === 'correct').map((item) => item.questionId), items }
  })
  if (new Set(history.map((entry) => entry.testId)).size !== history.length
    || history.some((entry, index) => entry.linkedToTestId !== (history[index + 1]?.testId ?? null))) {
    throw new Error('История должна содержать всю причинную цепочку до исходного теста.')
  }
  const historyFingerprint = createHash('sha256').update(JSON.stringify(stable(attempts.map(({ assignment, answerKey, review }) => ({
    testId: assignment.testId, linkedToTestId: assignment.linkedToTestId ?? null,
    questions: assignment.questions, answers: assignment.answers, assessment: assignment.assessment ?? null, answerKey, review,
  }))))).digest('hex')
  return { schemaVersion: 1, attempts: history, topics: [...topics.values()].sort((a, b) => a.topic.localeCompare(b.topic, 'ru')),
    next: continuationPlan(history, historyFingerprint, coverageCount) }
}

/** Publishing refuses a plan based only on the latest short successful round. */
export function assertLineageContinuation(plan, spec, attempts) {
  const coverage = plan?.continuation?.topicCoverage ?? []
  const sourceIds = new Set((plan.sources ?? []).filter((source) => source.verified === true && source.role === 'family-material').map((source) => source.id))
  const objectiveIds = new Set((plan.objectives ?? []).map((objective) => objective.id))
  if (!Array.isArray(coverage) || coverage.some((entry) => !objectiveIds.has(entry.objectiveId) || !sourceIds.has(entry.sourceId))
    || new Set(coverage.map((entry) => entry.objectiveId)).size !== coverage.length) throw new Error('Охват темы требует уникальных целей и подтверждённых семейных источников.')
  const expected = quizLineageStatistics(attempts, coverage.length).next
  if (expected.strategy === 'consolidation' && !coverage.length) throw new Error('Итоговая проверка требует матрицу всей темы из семейного материала.')
  const actual = plan?.continuation
  if (!actual || actual.historyFingerprint !== expected.historyFingerprint || actual.strategy !== expected.strategy
    || actual.policyVersion !== expected.policyVersion || actual.sourceTestId !== expected.sourceTestId) throw new Error('План продолжения не соответствует полной проверенной истории. Выполните quiz history заново.')
  if (spec.questions.length !== expected.targetCount) throw new Error(`Продолжение должно содержать ${expected.targetCount} вопросов.`)
  const checks = actual.checks ?? []
  const questionIds = new Set(spec.questions.map((question) => question.id))
  if (checks.length !== expected.slots.length || new Set(checks.map((check) => check.questionId)).size !== checks.length
    || new Set(checks.map((check) => check.slotId)).size !== checks.length) throw new Error('Каждому месту плана нужен отдельный новый вопрос.')
  for (const slot of expected.slots) {
    const check = checks.find((entry) => entry.slotId === slot.slotId)
    const item = plan.items?.find((entry) => entry.questionId === check?.questionId)
    if (!check || !questionIds.has(check.questionId) || !item
      || check.sourceTestId !== slot.sourceTestId || check.sourceQuestionId !== slot.sourceQuestionId
      || (slot.role === 'transfer' && item.layer !== 'transfer')
      || (slot.role === 'spaced' && item.layer !== 'spaced')
      || (slot.role === 'historical-error' && item.layer !== 'prior-gap')
      || (slot.role === 'current-error' && !plan.followupCoverage?.errors?.some((error) => error.sourceQuestionId === slot.sourceQuestionId && error.newQuestionIds?.includes(check.questionId)))) throw new Error(`Не подтверждено покрытие ${slot.slotId}: ${slot.role}.`)
  }
  if (coverage.some((entry) => !plan.items.some((item) => item.objectiveId === entry.objectiveId && item.sourceIds?.includes(entry.sourceId)))) {
    throw new Error('Не все цели полной темы покрыты вопросами.')
  }
  return expected
}
