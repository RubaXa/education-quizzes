/** @see ../docs/product/olympiad-preparation.md */
/**
 * Pure server-side lesson aggregate. The caller must authenticate family/child
 * membership before reading a lesson or applying a command. Never bundle the
 * private lesson definition into the student client.
 * @see ../docs/modules/assessments/olympiad-preparation.md
 */
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0 }
function fail(message) { throw new Error(message) }

export function validateLesson(lesson) {
  if (!lesson || !nonempty(lesson.id) || !nonempty(lesson.version) || !nonempty(lesson.topicId) || !nonempty(lesson.title) || !Array.isArray(lesson.steps) || !lesson.steps.length) fail('Invalid lesson')
  const stepIds = new Set()
  for (const step of lesson.steps) {
    if (!nonempty(step.id) || stepIds.has(step.id) || !nonempty(step.prompt) || !Array.isArray(step.options) || step.options.length < 2 || (!Array.isArray(step.correctOptionIds) || !step.correctOptionIds.length || !step.correctOptionIds.every(nonempty)) || !nonempty(step.correctExplanation) || !nonempty(step.incorrectHint)) fail('Invalid lesson step')
    stepIds.add(step.id)
    const optionIds = new Set()
    for (const option of step.options) {
      if (!nonempty(option.id) || !nonempty(option.text) || optionIds.has(option.id)) fail('Invalid lesson option')
      optionIds.add(option.id)
    }
    if (new Set(step.correctOptionIds).size !== step.correctOptionIds.length || !step.correctOptionIds.every((id) => optionIds.has(id))) fail('Correct option missing')
  }
  return lesson
}

export function startAttempt(lesson, identity) {
  validateLesson(lesson)
  if (!identity || !['attemptId', 'familyId', 'childId', 'olympiadId'].every((key) => nonempty(identity[key]))) fail('Invalid attempt identity')
  return { attemptId: identity.attemptId, familyId: identity.familyId, childId: identity.childId, olympiadId: identity.olympiadId, lessonId: lesson.id, lessonVersion: lesson.version, currentStep: 0, status: 'active', feedback: null, events: [] }
}

function validateAttempt(lesson, attempt) {
  validateLesson(lesson)
  if (!attempt || attempt.lessonId !== lesson.id || attempt.lessonVersion !== lesson.version || !Number.isInteger(attempt.currentStep) || attempt.currentStep < 0 || attempt.currentStep >= lesson.steps.length || !Array.isArray(attempt.events) || !['active', 'completed'].includes(attempt.status)) fail('Invalid attempt')
}

/** Commands use a caller-supplied stable ID and an ISO timestamp. An adapter must
 * serialize updates atomically and preserve those IDs on retry. */
export function applyLessonCommand(lesson, attempt, command) {
  validateAttempt(lesson, attempt)
  if (!command || !nonempty(command.id) || !nonempty(command.at) || !Number.isFinite(Date.parse(command.at))) fail('Invalid command')
  if (!['answer', 'advance'].includes(command.type)) fail('Unknown command')
  const previous = attempt.events.find((event) => event.id === command.id)
  if (previous) {
    if (previous.type !== command.type || (command.type === 'answer' && previous.optionId !== command.optionId)) fail('Command ID conflict')
    return attempt
  }
  if (attempt.status === 'completed') fail('Attempt is completed')
  const step = lesson.steps[attempt.currentStep]
  if (command.type === 'answer') {
    if (attempt.feedback?.correct) fail('Advance before answering')
    if (!step.options.some((option) => option.id === command.optionId)) fail('Unknown option')
    const correct = step.correctOptionIds.includes(command.optionId)
    const event = { id: command.id, type: 'answer', at: command.at, stepId: step.id, optionId: command.optionId, correct, hintShown: !correct }
    return { ...attempt, feedback: { correct, text: correct ? step.correctExplanation : step.incorrectHint }, events: [...attempt.events, event] }
  }
  if (!attempt.feedback?.correct) fail('Correct answer required')
  const event = { id: command.id, type: 'advance', at: command.at, stepId: step.id }
  if (attempt.currentStep === lesson.steps.length - 1) return { ...attempt, status: 'completed', feedback: null, events: [...attempt.events, event] }
  return { ...attempt, currentStep: attempt.currentStep + 1, feedback: null, events: [...attempt.events, event] }
}

/** This projection is safe only after the caller has authorized this child.
 * It deliberately excludes the key, other steps, event history and feedback for
 * choices not made. Parent-only data must be fetched through a separate scope. */
export function studentLessonView(lesson, attempt) {
  validateAttempt(lesson, attempt)
  const base = { lessonId: lesson.id, lessonVersion: lesson.version, title: lesson.title, topicId: lesson.topicId, status: attempt.status, currentStep: attempt.currentStep + 1, stepCount: lesson.steps.length, hintCount: attempt.events.filter((event) => event.type === 'answer' && event.hintShown).length }
  if (typeof lesson.theory === 'string' && lesson.theory.trim()) base.theory = lesson.theory
  if (attempt.status === 'completed') return base
  const step = lesson.steps[attempt.currentStep]
  return { ...base, step: { id: step.id, prompt: step.prompt, options: step.options.map(({ id, text }) => ({ id, text })) }, feedback: attempt.feedback && { ...attempt.feedback } }
}
