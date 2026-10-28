import type { DayUpload, DayWorkReview } from '@/lib/dayStore'
import PhotoUploadControl from './PhotoUploadControl'
import WorkPhotoGallery, { type LocalWorkPhoto } from './WorkPhotoGallery'

/** A queue of source photographs, using the same upload and gallery controls as written work.
 * @see ../../docs/modules/assessments/olympiad-preparation.md#свои-листы-и-происхождение
 */
export default function OlympiadSourceQueue<T extends LocalWorkPhoto>({ parent, studentToken, uploads, localPhotos, review, now, onPhotos, onRetry, onDelete, processedIds = [] }: {
  parent: boolean; studentToken: string; uploads: DayUpload[]; localPhotos: T[]; review?: DayWorkReview; now: number;
  processedIds?: string[]; onPhotos: (files: File[]) => void; onRetry?: (photo: T) => void; onDelete?: (id: string) => Promise<void>
}) {
  const complete = uploads.length > 0 && localPhotos.every(photo => uploads.some(upload => upload.id === photo.id || upload.id.endsWith(`:${photo.id}`))) && uploads.every(upload => processedIds.some(id => upload.id === id || upload.id.endsWith(`:${id}`)))
  return <section aria-label="Свои варианты">
    <strong>Очередь своих вариантов</strong>
    {!parent && <><p>Загружай новые страницы или дополнительные фотографии в любое время.</p><PhotoUploadControl label={uploads.length || localPhotos.length ? 'Добавить ещё фотографии' : 'Загрузить фотографии'} onPhotos={onPhotos} /></>}
    {!uploads.length && !localPhotos.length && <p>Загруженных фотографий пока нет.</p>}
    <WorkPhotoGallery taskTitle="Свои варианты" evidenceLabel="Фото условий" studentToken={studentToken} uploads={uploads} localPhotos={localPhotos} review={review} now={now} onRetry={onRetry} onDelete={parent ? undefined : onDelete} purpose={complete ? 'source-complete' : 'source'} />
  </section>
}
