import type { DayTask } from './dayStore'
import { isCdzTask } from './dayStore'

/** Earlier photos and review status never close an incomplete written task.
 * @see ../../docs/product/day-page.md#upload-queue */
export function pupilCanAddPhoto(task: DayTask, parent: boolean): boolean {
  return !parent && !task.referenceDate && !task.problems?.length
    && (task.kind === 'written' || isCdzTask(task))
}
