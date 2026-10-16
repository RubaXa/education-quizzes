import {
  BellDot, Circle, CircleAlert, CircleCheck, CircleDot, CircleHelp, CircleMinus,
  CirclePause, CircleX, Clock3, CloudUpload, LoaderCircle, TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import './StatusIcon.css'

/** Visual vocabulary only. The owning badge/summary supplies the full accessible label.
 * @see ../../docs/shared/design/statuses.md#matrix
 */
export type EducationStatus = 'ready' | 'started' | 'uploading' | 'waiting' | 'processing' | 'paused'
  | 'complete' | 'partial' | 'needs-fix' | 'incorrect' | 'unknown' | 'failed' | 'new'

const icons: Record<EducationStatus, LucideIcon> = {
  ready: Circle,
  started: CircleDot,
  uploading: CloudUpload,
  waiting: Clock3,
  processing: LoaderCircle,
  paused: CirclePause,
  complete: CircleCheck,
  partial: CircleMinus,
  'needs-fix': CircleAlert,
  incorrect: CircleX,
  unknown: CircleHelp,
  failed: TriangleAlert,
  new: BellDot,
}

export default function StatusIcon({ status, size = 16, className = '' }: {
  status: EducationStatus; size?: number; className?: string
}) {
  const Icon = icons[status]
  return <Icon size={size} className={`edu-status-icon edu-status-icon-${status} ${className}`.trim()} data-status={status} aria-hidden="true" />
}
