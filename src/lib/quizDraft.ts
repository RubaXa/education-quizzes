import type { Answer, Assignment } from './quiz'

/** A device-local safety copy of answers that Firestore has not confirmed yet.
 * @see ../../docs/modules/assessments/quizzes.md#quiz-runner */
const key = (token: string) => `education.quiz-draft.v1.${token}`
const assignmentKey = (token: string) => `education.quiz-assignment.v1.${token}`
const studentKey = (token: string, deviceUid: string) => `education.quiz-student.v1.${token}.${deviceUid}`

export function rememberQuizStudent(token: string, deviceUid: string): void {
  try { window.localStorage.setItem(studentKey(token, deviceUid), '1') } catch { /* Offline recovery remains unavailable. */ }
}

export function wasQuizStudent(token: string, deviceUid: string): boolean {
  try { return window.localStorage.getItem(studentKey(token, deviceUid)) === '1' }
  catch { return false }
}

export function readCachedQuiz(token: string): Assignment | null {
  try {
    const raw = window.localStorage.getItem(assignmentKey(token))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<Assignment>
    if (value.schemaVersion !== 1 || !Array.isArray(value.questions) || typeof value.title !== 'string' || typeof value.subject !== 'string') return null
    return value as Assignment
  } catch {
    return null
  }
}

export function writeCachedQuiz(token: string, assignment: Assignment): void {
  try {
    window.localStorage.setItem(assignmentKey(token), JSON.stringify(assignment))
  } catch {
    // The answer backup takes precedence if browser storage is full or disabled.
  }
}

export function readQuizDraft(token: string): Record<string, Answer> {
  try {
    const raw = window.localStorage.getItem(key(token))
    if (!raw) return {}
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Answer] =>
      typeof entry[1] === 'string' || Array.isArray(entry[1]) && entry[1].every((part) => typeof part === 'string')))
  } catch {
    return {}
  }
}

export function writeQuizDraft(token: string, answers: Record<string, Answer>): boolean {
  try {
    if (Object.keys(answers).length) window.localStorage.setItem(key(token), JSON.stringify(answers))
    else window.localStorage.removeItem(key(token))
    return true
  } catch {
    return false
  }
}
