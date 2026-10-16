import { grade, summarize } from './quiz'
import type { AnswerKey, Assignment, ManualReview, QuestionResult } from './quiz'
import type { QuizScore } from './homeworkStatus'
import { watchAnswerKey, watchAssignment, watchReview } from './store'

export type QuizOutcome = { assignment: Assignment; score?: QuizScore; results?: QuestionResult[]; scoreReady: boolean }

/** One live result projection for every test card and parent overview.
 * Manual review can arrive after submission; its Firestore update must finish the score everywhere.
 * @see ../../docs/modules/assessments/quizzes.md#quiz-results
 * @see ../../docs/modules/reviews/subject-card-viewmodel.md#projections
 */
export function watchQuizOutcome(token: string, onChange: (outcome: QuizOutcome) => void, onError: (error: Error) => void) {
  let assignment: Assignment | undefined
  let key: AnswerKey | undefined
  let review: ManualReview | undefined
  let reviewReady = false
  let stopKey: (() => void) | undefined
  let stopReview: (() => void) | undefined

  const emit = () => {
    if (!assignment) return
    if (assignment.status !== 'submitted') { onChange({ assignment, scoreReady: true }); return }
    if (!key || !reviewReady) { onChange({ assignment, scoreReady: false }); return }
    const results = grade(assignment, key, review)
    const summary = summarize(results)
    const score = summary.pending ? undefined : {
      points: summary.earned,
      maxPoints: summary.possible,
    }
    onChange({ assignment, score, results, scoreReady: true })
  }

  const stopAssignment = watchAssignment(token, (next) => {
    assignment = next
    if (next.status === 'submitted' && !stopKey) {
      stopKey = watchAnswerKey(token, (value) => { key = value; emit() }, onError)
      stopReview = watchReview(token, (value) => { review = value; reviewReady = true; emit() }, onError)
    }
    emit()
  }, onError)
  return () => { stopAssignment(); stopKey?.(); stopReview?.() }
}
