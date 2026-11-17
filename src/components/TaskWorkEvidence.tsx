/** @see ../../docs/decisions/canonical-evidence-and-learning-2026-11-17.md */
/** Canonical numbered-task attachments; day and weekend choose their established layouts explicitly.
 * @see ../../docs/shared/design/components.md#work-artifacts */
import type { DayPageData, DayUpload, DayWorkReview } from '@/lib/dayStore'
import { taskUploadPresentation } from '@/lib/taskUploadPresentation'
import WorkPhotoGallery, { type LocalWorkPhoto } from './WorkPhotoGallery'

export default function TaskWorkEvidence<T extends LocalWorkPhoto>({ layout, taskId, taskTitle, evidenceLabel, studentToken, uploads, localPhotos, review, now, onRetry, onDelete }: {
  layout: 'day' | 'weekend'; taskId: string; taskTitle: string; evidenceLabel?: string; studentToken: string; uploads: DayUpload[]; localPhotos: T[];
  review?: DayWorkReview; now: number; pages: (DayPageData | undefined)[]; onRetry?: (photo: T) => void; onDelete?: (uploadId: string) => Promise<void>
}) {
  const presentation = taskUploadPresentation(uploads, taskId)
  return <WorkPhotoGallery compact={layout === 'weekend'} taskTitle={taskTitle} evidenceLabel={evidenceLabel} studentToken={studentToken} uploads={[...new Map([...presentation.owned, ...presentation.evidence].map(upload => [upload.id, upload])).values()]} readOnlyUploadIds={presentation.linked.map(upload => upload.id)} localPhotos={localPhotos} review={review} now={now} onRetry={onRetry} onDelete={onDelete} />
}
