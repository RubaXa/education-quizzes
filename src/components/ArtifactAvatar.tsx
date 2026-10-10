import type { ReactNode } from 'react'
import { Camera, CheckCircle2, CircleAlert, Clock3, LoaderCircle } from 'lucide-react'
import type { ArtifactAvatarState } from '@/lib/reviewPresentation'
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
