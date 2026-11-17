/** @see ../../docs/decisions/quiz-review-dialogue-2026-11-17.md */
import type {DayWorkReview} from '../../src/lib/dayStore'
import type {QuestionGuidance} from '../../src/lib/quiz'
export function quizQuestionReview(questionId:string,submittedAt:unknown,guidance?:QuestionGuidance):DayWorkReview
