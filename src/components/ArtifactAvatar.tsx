import type { ReactNode } from 'react'
import { Camera, CheckCircle2, CircleAlert, Clock3, LoaderCircle } from 'lucide-react'
import type { ArtifactAvatarState } from '@/lib/reviewPresentation'
import type { DayUpload } from '@/lib/dayStore'
import { localPhotoForTransfer } from '@/lib/photoOutbox'
import EducationImage from './EducationImage'
import './ArtifactAvatar.css'

export function ArtifactStatusGlyph({ state, size = 10 }: { state: ArtifactAvatarState; size?: number }) {
  return state === 'uploading' || state === 'processing' ? <LoaderCircle size={size} aria-hidden="true" />
    : state === 'reviewed' ? <CheckCircle2 size={size} aria-hidden="true" />
      : state === 'failed' ? <CircleAlert size={size} aria-hidden="true" /> : <Clock3 size={size} aria-hidden="true" />
}

/** The same image and state badge for uploaded work in every task view.
 * @see ../../docs/product/day-page.md#photo-status
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
 * @see ../../docs/product/component-system.md#work-artifacts
 * @see ../../docs/product/design-system.md#images */
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
