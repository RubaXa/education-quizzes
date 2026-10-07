export type Answer = string | string[]

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
  testId: string
  title: string
  description?: string
  subject: string
  visual?: QuizVisual
  reading?: QuizReading
  questions: QuizQuestion[]
  status: 'open' | 'submitted'
  answers: Record<string, Answer>
  startedAt: unknown | null
  updatedAt: unknown | null
  submittedAt: unknown | null
}

export function countAnswered(assignment: Assignment): number {
  return assignment.questions.filter((question) => {
    const answer = assignment.answers?.[question.id]
    return typeof answer === 'string' ? answer.trim().length > 0 : Array.isArray(answer) && answer.length > 0
  }).length
}

export type AnswerKey = {
  entries: Record<string, {
    correct?: Answer
    accepted?: string[]
    tolerance?: number
    explanation?: string
    source?: string
    learning?: LearningGuide
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
  explanation?: string
  source?: string
  learning?: LearningGuide
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
  return assignment.questions.map((question) => {
    const answer = assignment.answers[question.id]
    const expected = key.entries[question.id]
    const manual = review?.entries?.[question.id]

    if (question.kind === 'long') {
      return {
        question,
        answer,
        correctAnswer: expected?.correct,
        points: manual ? Math.max(0, Math.min(question.points, manual.points)) : null,
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
      explanation: correct ? undefined : expected.explanation,
      source: correct ? undefined : expected.source,
      learning: correct ? undefined : expected.learning,
    }
  })
}

export function summarize(results: QuestionResult[]) {
  return {
    earned: results.reduce((total, result) => total + (result.points ?? 0), 0),
    possible: results.reduce((total, result) => total + result.question.points, 0),
    pending: results.filter((result) => result.points === null).length,
  }
}
