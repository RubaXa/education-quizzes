/** @see ../../docs/modules/materials/material-clarification.md */
import type { DayTask } from './dayStore'

/** Every current, non-test task accepts learner evidence; status does not
 * determine whether the pupil can submit or add another photo.
 * Test-only cards use QuizLineageCard and never reach this control.
 * @see ../../docs/modules/school-diary/day-page.md#upload-queue
 * @see ../../docs/decisions/non-test-result-upload-2026-10-19.md */
export function pupilCanAddPhoto(task: DayTask, parent: boolean): boolean {
  return !parent && !task.referenceDate && !task.problems?.length
}
