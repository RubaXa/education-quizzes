/** @see ../../docs/decisions/quiz-review-dialogue-2026-11-17.md */
/** @see ../../docs/decisions/assignment-source-audit-corrections-2026-11-16.md */
/** @see ../../docs/decisions/program-explanation-2026-11-01.md */
/** @see ../../docs/modules/assessments/quizzes.md#author-scope-correction */
/**
 * @see ../../docs/product/assessments.md
 * @see ../../docs/modules/assessments/README.md
 */
export type Answer = string | string[]

/** Manually checked, student-safe feedback. Never derive it from the closed solution. */
export type QuestionGuidance = {
  mode?: 'program-explanation'
  answerFeedback?: import('../../packages/education-presentation/review-content.mjs').OpenAnswerFeedback
  reason?: string
  presentation?: import('../../packages/education-presentation/review-content.mjs').ReviewSupplement
  observation: string
  question?: string
  source: { title: string; edition: string; section: string; pages: string; locator: string; url?: string }
}

export type QuizOption = {
  id: string
  label: string
  imageUrl?: string
  imageAlt?: string
}

export type QuizQuestion = {
  id: string
  kind: 'single' | 'multiple' | 'short' | 'number' | 'long' | 'figure'
  prompt: string
  code?: string
  points: number
  options?: QuizOption[]
  imageUrl?: string
  imageAlt?: string
  topic?: string
}

export type QuizVisual = {
  preset?: 'english' | 'informatics' | 'biology' | 'literature' | 'history' | 'math' | 'russian' | 'geography' | 'physics' | 'chemistry' | 'general'
  scene?: 'city' | 'language' | 'code' | 'nature' | 'story' | 'archive' | 'shapes' | 'atlas' | 'lab'
  eyebrow?: string
  caption?: string
}

export type QuizReading = {
  heading: string
  paragraphs: string[]
}

export type Assignment = {
  schemaVersion: 1
  /** Words require source-based semantic review; absent only on historical attempts. */
  textAnswerReviewVersion?: 1
  /** Placement only; access continues to follow the assignment's family. */
  learningContext?: { kind: 'homework' | 'course' | 'olympiad'; id: string }
  testId: string
  linkedToTestId?: string | null
  followupRequestedAt?: unknown
  followupRequestedBy?: string
  /** Parent's choice for this root self-check. Absent means required. */
  familyOptional?: boolean
  familyChoiceAt?: unknown
  familyChoiceBy?: string
  /** Public routing metadata only; private assessment plan and learner evidence stay in work/. */
  assessment?: { policyVersion: 1; mode: 'ordinary' | 'control-diagnostic' | 'control-followup' | 'targeted-followup'; subjectAdapter: string; unansweredPolicy?: 'optional' }
  /** Operator correction of an author's out-of-scope question; never pupil optionality. */
  authorScopeExclusions?: { version: 1; revision: number; questionIds: string[] }
  title: string
  description?: string
  subject: string
  visual?: QuizVisual
  reading?: QuizReading
  questions: QuizQuestion[]
  status: 'open' | 'submitted'
  answers: Record<string, Answer>
  createdAt?: unknown
  startedAt: unknown | null
  updatedAt: unknown | null
  submittedAt: unknown | null
}

export function countAnswered(assignment: Assignment): number {
  const excluded = excludedQuizQuestionIds(assignment)
  return assignment.questions.filter((question) => {
    if (excluded.has(question.id)) return false
    const answer = assignment.answers?.[question.id]
    return typeof answer === 'string' ? answer.trim().length > 0 : Array.isArray(answer) && answer.length > 0
  }).length
}

/** Only the addressed, admin-written author correction affects assessment scope. */
export function excludedQuizQuestionIds(assignment: Pick<Assignment, 'authorScopeExclusions'>): Set<string> {
  const scope = assignment.authorScopeExclusions
  return scope?.version === 1 && Number.isInteger(scope.revision) && scope.revision > 0 && Array.isArray(scope.questionIds)
    ? new Set(scope.questionIds.filter(id => typeof id === 'string')) : new Set()
}

export function requiredQuizQuestionCount(assignment: Pick<Assignment, 'questions' | 'authorScopeExclusions'>): number {
  const excluded = excludedQuizQuestionIds(assignment)
  return assignment.questions.filter(q => !excluded.has(q.id)).length
}

export type AnswerKey = {
  entries: Record<string, {
    correct?: Answer
    accepted?: string[]
    tolerance?: number
    explanation?: string
    source?: string
    learning?: LearningGuide
    guidance?: QuestionGuidance
  }>
}

export type LearningGuide = {
  rule: string
  why: string
  textbook: string
  nextStep: string
  sourceHeading?: string
  textbookUrl?: string
  url?: string
  urlLabel?: string
}

export type ManualReview = {
  entries?: Record<string, {
    points: number
    explanation: string
    source?: string
    learning?: LearningGuide
  }>
}

export type QuestionResult = {
  question: QuizQuestion
  answer?: Answer
  correctAnswer?: Answer
  points: number | null
  skipped?: boolean
  excluded?: boolean
  explanation?: string
  source?: string
  learning?: LearningGuide
  guidance?: QuestionGuidance
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU')
}

function normalizeNumber(value: string): number {
  const trimmed = value.trim()
  return trimmed ? Number(trimmed.replace(',', '.')) : Number.NaN
}

export function grade(
  assignment: Assignment,
  key: AnswerKey,
  review?: ManualReview,
): QuestionResult[] {
  const excluded = excludedQuizQuestionIds(assignment)
  return assignment.questions.map((question) => {
    const answer = assignment.answers[question.id]
    if (excluded.has(question.id)) return { question, answer, points: null, excluded: true }
    const expected = key.entries[question.id]
    const manual = review?.entries?.[question.id]
    const answered = typeof answer === 'string' ? Boolean(answer.trim()) : Array.isArray(answer) && answer.length > 0

    if (!answered) {
      const skipped = assignment.assessment?.unansweredPolicy === 'optional'
      return { question, answer, points: skipped ? null : 0, skipped,
        guidance: skipped ? undefined : expected?.guidance,
        correctAnswer: skipped ? undefined : expected?.correct,
        explanation: skipped ? undefined : expected?.explanation,
        source: skipped ? undefined : expected?.source,
        learning: skipped ? undefined : expected?.learning }
    }

    if (needsManualTextReview(assignment, question)) {
      return {
        question,
        answer,
        correctAnswer: expected?.correct,
        points: manual ? Math.max(0, Math.min(question.points, manual.points)) : null,
        guidance: expected?.guidance,
        explanation: manual?.explanation,
        source: manual?.source ?? expected?.source,
        learning: manual ? manual.learning ?? expected?.learning : undefined,
      }
    }

    if (!expected) {
      return { question, answer, points: null }
    }

    let correct = false
    if (question.kind === 'single' || question.kind === 'figure') {
      correct = typeof answer === 'string' && answer === expected.correct
    } else if (question.kind === 'multiple') {
      const actual = Array.isArray(answer) ? [...answer].sort() : []
      const wanted = Array.isArray(expected.correct) ? [...expected.correct].sort() : []
      correct = actual.length === wanted.length && actual.every((item, index) => item === wanted[index])
    } else if (question.kind === 'short') {
      const accepted = expected.accepted ?? (typeof expected.correct === 'string' ? [expected.correct] : [])
      correct = typeof answer === 'string' && accepted.some((item) => normalize(item) === normalize(answer))
    } else if (question.kind === 'number') {
      const wanted = typeof expected.correct === 'string' ? normalizeNumber(expected.correct) : Number.NaN
      const actual = typeof answer === 'string' ? normalizeNumber(answer) : Number.NaN
      correct = Number.isFinite(actual) && Number.isFinite(wanted)
        && Math.abs(actual - wanted) <= (expected.tolerance ?? 0)
    }

    return {
      question,
      answer,
      correctAnswer: expected.correct,
      points: correct ? question.points : 0,
      guidance: expected.guidance,
      explanation: correct ? undefined : expected.explanation,
      source: correct ? undefined : expected.source,
      learning: correct ? undefined : expected.learning,
    }
  })
}

/** @see ../../docs/modules/assessments/quizzes.md#semantic-short-answer */
export function needsManualTextReview(assignment: Pick<Assignment, 'textAnswerReviewVersion'>, question: Pick<QuizQuestion, 'kind'>): boolean {
  return question.kind === 'long' || (question.kind === 'short' && assignment.textAnswerReviewVersion === 1)
}

export function summarize(results: QuestionResult[]) {
  return {
    earned: results.reduce((total, result) => total + (result.excluded ? 0 : result.points ?? 0), 0),
    possible: results.reduce((total, result) => total + (result.skipped || result.excluded ? 0 : result.question.points), 0),
    pending: results.filter((result) => !result.skipped && !result.excluded && result.points === null).length,
    skipped: results.filter((result) => result.skipped).length,
    excluded: results.filter((result) => result.excluded).length,
  }
}
