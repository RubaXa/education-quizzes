import { ChevronDown } from 'lucide-react'
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
  const complete = uploads.length > 0 && localPhotos.length === 0 && uploads.every(upload => processedIds.some(id => upload.id === id || upload.id.endsWith(`:${id}`)))
  return <section aria-label="Свои варианты">
    {!parent && <details className="day-practice-variant"><summary><strong>Загрузить свой вариант</strong><ChevronDown size={17} aria-hidden="true" /></summary><p>Добавь фотографии страниц с условиями задач.</p><PhotoUploadControl label="Добавить фото условий" onPhotos={onPhotos} /></details>}
    <strong>Очередь своих вариантов</strong>
    {!uploads.length && !localPhotos.length && <p>Загруженных фотографий пока нет.</p>}
    <WorkPhotoGallery taskTitle="Свои варианты" evidenceLabel="Фото условий" studentToken={studentToken} uploads={uploads} localPhotos={localPhotos} review={review} now={now} onRetry={onRetry} onDelete={parent ? undefined : onDelete} purpose={complete ? 'source-complete' : 'source'} />
  </section>
}
