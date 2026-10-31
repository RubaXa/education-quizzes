/** Canonical numbered-task attachments; day and weekend choose their established layouts explicitly.
 * @see ../../docs/shared/design/components.md#work-artifacts */
import type { DayPageData, DayUpload, DayWorkReview } from '@/lib/dayStore'
import { taskUploadPresentation } from '@/lib/taskUploadPresentation'
import WorkPhotoGallery, { type LocalWorkPhoto } from './WorkPhotoGallery'
import LinkedWorkPhotos from './LinkedWorkPhotos'

export default function TaskWorkEvidence<T extends LocalWorkPhoto>({ layout, taskId, taskTitle, studentToken, uploads, localPhotos, review, now, pages, onRetry, onDelete }: {
  layout: 'day' | 'weekend'; taskId: string; taskTitle: string; studentToken: string; uploads: DayUpload[]; localPhotos: T[];
  review?: DayWorkReview; now: number; pages: (DayPageData | undefined)[]; onRetry?: (photo: T) => void; onDelete?: (uploadId: string) => Promise<void>
}) {
  return <><WorkPhotoGallery compact={layout === 'weekend'} taskTitle={taskTitle} studentToken={studentToken} uploads={taskUploadPresentation(uploads, taskId).owned} localPhotos={localPhotos} review={review} now={now} onRetry={onRetry} onDelete={onDelete} /><LinkedWorkPhotos taskId={taskId} uploads={uploads} pages={pages} /></>
}
