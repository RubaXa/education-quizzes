/* @see ../../docs/decisions/upload-origin-links-2026-10-18.md */
import { useState } from 'react'
import { Link2 } from 'lucide-react'
import type { DayPageData, DayUpload } from '@/lib/dayStore'
import { taskUploadPresentation, uploadOriginTitle } from '@/lib/taskUploadPresentation'
import { WorkArtifactImage } from './ArtifactAvatar'
import './LinkedWorkPhotos.css'

/** Read-only references, not another upload gallery or attachment owner.
 * @see ../../docs/modules/materials/storage-privacy.md#multi-task-photo
 */
export default function LinkedWorkPhotos({ taskId, uploads, pages }: { taskId: string; uploads: DayUpload[]; pages: (DayPageData | undefined)[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const linked = taskUploadPresentation(uploads, taskId).linked
  if (!linked.length) return null
  return <div className="linked-work-photos" aria-label="Связанные фото из других заданий">
    {linked.map((upload, index) => {
      const title = uploadOriginTitle(upload, pages)
      const open = selected === upload.id
      return <div key={upload.id}>
        <button type="button" className="linked-work-photo-reference" aria-expanded={open} onClick={() => setSelected(open ? null : upload.id)}>
          <Link2 size={15} aria-hidden="true" /><span>Фото загружено в «{title}»{linked.length > 1 ? ` · фото ${index + 1}` : ''}</span>
        </button>
        {open && <div className="linked-work-photo-view"><p>Это ссылка на исходное фото. Здесь оно используется для проверки решения; файл остаётся в месте загрузки.</p><WorkArtifactImage upload={upload} title={title} index={index} /></div>}
      </div>
    })}
  </div>
}
