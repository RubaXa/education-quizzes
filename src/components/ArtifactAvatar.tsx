/** @see ../../docs/decisions/upload-photo-timestamp-2026-10-21.md */
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

/** Timestamp from upload.createdAt only; archive imports are named as archive additions. @see ../../docs/modules/school-diary/day-page.md#photo-timestamp */
export function workUploadTimeLabel(upload: DayUpload): string {
  const timestamp = formatUploadTimestamp(upload.createdAt)
  if (!timestamp) return 'Время загрузки неизвестно'
  if (upload.origin === 'archive') return `Добавлено в архив ${timestamp.label}`
  if (upload.status === 'requested' || upload.status === 'awaiting-upload' || upload.status === 'upload-error') return `Заявка создана ${timestamp.label}`
  return `Загружено ${timestamp.label}`
}

/** Compact timestamp shown only with the expanded image, so touch users can read it. */
export function WorkUploadTime({ upload }: { upload: DayUpload }) {
  const timestamp = formatUploadTimestamp(upload.createdAt)
  if (!timestamp) return <p className="work-upload-time">Время загрузки неизвестно</p>
  return <p className="work-upload-time"><time dateTime={timestamp.dateTime}>{workUploadTimeLabel(upload)}</time></p>
}
