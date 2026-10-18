/* @see ../../docs/decisions/upload-origin-links-2026-10-18.md */
import { uploadMatchesTask } from './dayStore'
import type { DayPageData, DayUpload } from './dayStore'

/** Upload placement never changes when evidence coverage is discovered.
 * @see ../../docs/modules/materials/storage-privacy.md#multi-task-photo
 */
export function taskUploadPresentation(uploads: DayUpload[], taskId: string) {
  const unique = [...new Map(uploads.map((upload) => [upload.id, upload])).values()]
  const evidence = unique.filter((upload) => uploadMatchesTask(upload, taskId))
  return { owned: unique.filter((upload) => upload.taskId === taskId), evidence,
    linked: evidence.filter((upload) => upload.taskId !== taskId) }
}

/** Labels come only from already authorized pages; never fetch another source.
 * @see ../../docs/modules/materials/storage-privacy.md#multi-task-photo
 */
export function uploadOriginTitle(upload: DayUpload, pages: (DayPageData | undefined)[]) {
  for (const page of pages) for (const subject of page?.subjects ?? []) for (const task of subject.tasks) {
    if (task.id === upload.taskId) return task.title
    const problem = task.problems?.find((item) => item.id === upload.taskId)
    if (problem) {
      const variant = task.practiceVariants?.find((item) => item.id === problem.variantId)?.title
      return `${variant ? `${variant} · ` : ''}№ ${problem.number}. ${problem.title}`
    }
  }
  return 'другое задание'
}
