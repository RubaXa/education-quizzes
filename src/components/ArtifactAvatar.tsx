/** @see ../../docs/decisions/upload-photo-timestamp-2026-10-21.md
 * @see ../../docs/decisions/photo-transfer-recovery-2026-10-22.md */
import type { ReactNode } from 'react'
import { Camera } from 'lucide-react'
import type { ArtifactAvatarState } from '@/lib/reviewPresentation'
import type { DayUpload } from '@/lib/dayStore'
import { localPhotoForTransfer } from '@/lib/photoOutbox'
import EducationImage from './EducationImage'
import StatusIcon from './StatusIcon'
import './ArtifactAvatar.css'
import { formatUploadTimestamp } from '@/lib/uploadTimestamp'

export function ArtifactStatusGlyph({ state, size = 10 }: { state: ArtifactAvatarState; size?: number }) {
  return <StatusIcon status={state === 'reviewed' ? 'complete' : state === 'failed' ? 'failed' : state} size={size} />
}

/** The same image and state badge for uploaded work in every task view.
 * @see ../../docs/modules/school-diary/day-page.md#photo-status
 * @see ../../docs/shared/design/statuses.md#components
 */
export default function ArtifactAvatar({ state, children }: { state: ArtifactAvatarState; children?: ReactNode }) {
  return <span className="artifact-avatar">
    <span className="artifact-avatar-image">{children ?? <span className="artifact-avatar-placeholder"><Camera size={15} aria-hidden="true" /></span>}</span>
    <span className={`artifact-avatar-indicator ${state}`} aria-hidden="true"><ArtifactStatusGlyph state={state} /></span>
  </span>
}

async function localWorkImage(source: string): Promise<string> {
  const [studentToken, uploadId] = source.split(':')
  const blob = await localPhotoForTransfer(studentToken, uploadId)
  if (!blob) throw new Error('Исходное фото не найдено на этом устройстве.')
  return URL.createObjectURL(blob)
}

/** One source-selection path for a saved work image on the day and weekend views.
 * The upload state remains separate from the educational review state.
 * @see ../../docs/shared/design/components.md#work-artifacts
 * @see ../../docs/shared/design/README.md#images */
export function WorkArtifactImage({ upload, title, index, compact = false, fallbackUrl, retryControl = !compact }: {
  upload: DayUpload; title: string; index: number; compact?: boolean; fallbackUrl?: string; retryControl?: boolean;
}) {
  const publicUrl = upload.storage?.publicUrl
  const local = !upload.dataUrl && !publicUrl && !fallbackUrl
  return <EducationImage source={upload.dataUrl ?? publicUrl ?? fallbackUrl ?? upload.id}
    mode={publicUrl && !upload.dataUrl ? 'public' : 'direct'}
    resolver={local ? localWorkImage : undefined} revokeResolvedUrl={local} size={compact ? 'S' : 'XXXL'}
    alt={`Работа по заданию «${title}», фото ${index + 1}`} compact={compact} retryControl={retryControl}
    className={compact ? '' : 'day-upload-photo'} />
}

/** Received files use the server's byte-confirmation time; a request time is never called an upload time.
 * @see ../../docs/modules/school-diary/day-page.md#photo-timestamp
 * @see ../../docs/decisions/photo-transfer-recovery-2026-10-22.md
 */
function workUploadTimestamp(upload: DayUpload) {
  if (upload.origin === 'archive') {
    const timestamp = formatUploadTimestamp(upload.createdAt)
    return { timestamp, label: timestamp ? `Добавлено в архив ${timestamp.label}` : 'Время добавления в архив неизвестно' }
  }
  const requestStatus = ['requested', 'awaiting-upload', 'upload-error'].includes(upload.status)
  if (!requestStatus) {
    const received = formatUploadTimestamp(upload.storage?.syncedAt)
    if (received) return { timestamp: received, label: `Загружено ${received.label}` }
  }
  const requested = formatUploadTimestamp(upload.createdAt)
  if (requested) return { timestamp: requested, label: `Заявка создана ${requested.label}` }
  return { timestamp: null, label: requestStatus ? 'Время заявки неизвестно' : 'Время получения неизвестно' }
}

export function workUploadTimeLabel(upload: DayUpload): string {
  return workUploadTimestamp(upload).label
}

/** Compact timestamp shown only with the expanded image, so touch users can read it. */
export function WorkUploadTime({ upload }: { upload: DayUpload }) {
  const { timestamp, label } = workUploadTimestamp(upload)
  if (!timestamp) return <p className="work-upload-time">{label}</p>
  return <p className="work-upload-time"><time dateTime={timestamp.dateTime}>{label}</time></p>
}
