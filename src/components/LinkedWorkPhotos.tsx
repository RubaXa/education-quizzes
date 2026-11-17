/** @see ../../docs/decisions/canonical-evidence-and-learning-2026-11-17.md */
import { workFilePresentation } from '../../storage/work-file-types.mjs'
/** @see ../../docs/decisions/upload-photo-timestamp-2026-10-21.md */
/* @see ../../docs/decisions/upload-origin-links-2026-10-18.md */
import type { DayPageData, DayUpload, DaySourceCrop } from '@/lib/dayStore'
import { taskUploadPresentation } from '@/lib/taskUploadPresentation'
import WorkPhotoGallery from './WorkPhotoGallery'
import SourceFragment from './SourceFragment'
import { traceOlympiad } from '@/lib/browserAccessTrace'

/** Read-only selection adapter for the canonical thumbnail gallery; never an attachment owner.
 * @see ../../docs/modules/materials/storage-privacy.md#multi-task-photo
 */
export default function LinkedWorkPhotos({ taskId, uploads, source, number = 1, role, diagnosticsContext = 'product' }: { taskId: string; uploads: DayUpload[]; pages: (DayPageData | undefined)[]; source?: { intakeTaskId: string; uploadIds: string[]; crop?: DaySourceCrop }; number?: number; role?: 'parent' | 'student'; diagnosticsContext?: 'product' | 'demo' }) {
  const linked = source ? uploads.filter(upload => upload.taskId === source.intakeTaskId && source.uploadIds.some(id => upload.id === id || upload.id.endsWith(`:${id}`))) : taskUploadPresentation(uploads, taskId).linked
  if (!linked.length) return null
  const crop = source?.crop
  if (crop && linked.length === 1 && workFilePresentation(linked[0]).kind === 'photo' && linked[0].storage?.sha256 === crop.sourceSha256) return <SourceFragment upload={linked[0]} crop={crop} number={number} onOpen={role ? () => traceOlympiad('source-fragment-opened', diagnosticsContext, role) : undefined} />
  return <WorkPhotoGallery taskTitle={source ? 'Фото условия' : 'Фото работы'} evidenceLabel={source ? 'Фото условия' : 'Фото работы'} studentToken="" uploads={linked} localPhotos={[]} now={Date.now()} purpose={source ? 'source' : undefined} />
}
