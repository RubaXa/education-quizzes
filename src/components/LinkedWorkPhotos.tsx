/** @see ../../docs/decisions/upload-photo-timestamp-2026-10-21.md */
/* @see ../../docs/decisions/upload-origin-links-2026-10-18.md */
import { useState } from 'react'
import { Link2 } from 'lucide-react'
import type { DayPageData, DayUpload } from '@/lib/dayStore'
import { taskUploadPresentation, uploadOriginTitle } from '@/lib/taskUploadPresentation'
import { artifactAvatarLabel, artifactAvatarState } from '@/lib/reviewPresentation'
import { WorkArtifactImage, WorkUploadTime, workUploadTimeLabel } from './ArtifactAvatar'
import SourceFragment from './SourceFragment'
import { traceOlympiad } from '@/lib/browserAccessTrace'
import type { DaySourceCrop } from '@/lib/dayStore'
import './LinkedWorkPhotos.css'

/** Read-only references, not another upload gallery or attachment owner.
 * @see ../../docs/modules/materials/storage-privacy.md#multi-task-photo
 */
export default function LinkedWorkPhotos({ taskId, uploads, pages, source, number = 1, role, diagnosticsContext = 'product' }: { taskId: string; uploads: DayUpload[]; pages: (DayPageData | undefined)[]; source?: { intakeTaskId: string; uploadIds: string[]; crop?: DaySourceCrop }; number?: number; role?: 'parent' | 'student'; diagnosticsContext?: 'product' | 'demo' }) {
  const [selected, setSelected] = useState<string | null>(null)
  const linked = source ? uploads.filter(upload => upload.taskId === source.intakeTaskId && source.uploadIds.some(id => upload.id === id || upload.id.endsWith(`:${id}`))) : taskUploadPresentation(uploads, taskId).linked
  if (!linked.length) return null
  const crop = source?.crop
  if (crop && linked.length === 1 && linked[0].storage?.sha256 === crop.sourceSha256) return <SourceFragment upload={linked[0]} crop={crop} number={number} onOpen={role ? () => traceOlympiad('source-fragment-opened', diagnosticsContext, role) : undefined} />
  return <div className="linked-work-photos" aria-label={source ? "Фотографии условий" : "Связанные фото из других заданий"}>
    {linked.map((upload, index) => {
      const title = uploadOriginTitle(upload, pages)
      const open = selected === upload.id
      const photoStatus = artifactAvatarLabel(artifactAvatarState(upload, undefined, Date.now()))
      const photoLabel = `Фото ${index + 1} · ${photoStatus} · ${workUploadTimeLabel(upload)}`
      return <div key={upload.id}>
        <button type="button" className="linked-work-photo-reference" title={photoLabel} aria-label={`Открыть ${photoLabel}; загружено в «${title}»`} aria-expanded={open} onClick={() => setSelected(open ? null : upload.id)}>
          <Link2 size={15} aria-hidden="true" /><span>{source ? 'Фото условия' : `Фото загружено в «${title}»`}{linked.length > 1 ? ` · фото ${index + 1}` : ''}</span>
        </button>
        {open && <div className="linked-work-photo-view"><WorkUploadTime upload={upload} /><p>{source ? 'Это исходное фото листа с условием задачи.' : 'Это ссылка на исходное фото. Здесь оно используется для проверки решения; файл остаётся в месте загрузки.'}</p><WorkArtifactImage upload={upload} title={title} index={index} /></div>}
      </div>
    })}
  </div>
}
