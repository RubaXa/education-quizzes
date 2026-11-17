/** @see ../../docs/decisions/quiz-review-dialogue-2026-11-17.md */
/** A question's public step identity, shared by browser and operator. No answer key.
 * @see ../../docs/shared/design/student-review-step.md#quiz-dialogue */
import {projectReviewSupplement} from './review-content.mjs'
export function quizQuestionReview(questionId,submittedAt,guidance){
 const activity=projectReviewSupplement(guidance?.presentation)?.activity
 const step={question:guidance?.question,activity}
 return {id:`quiz:${questionId}`,taskId:questionId,status:'partial',checkedAt:submittedAt??null,correctedAt:step,
  studentFeedback:{title:'Проверь этот шаг',question:step.question,presentation:{version:1,activity}}}
}
