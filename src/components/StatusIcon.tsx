import {
  BellDot, Circle, CircleAlert, CircleCheck, CircleDot, CircleHelp, CircleMinus,
  CirclePause, CircleX, Clock3, CloudUpload, LoaderCircle, TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { STATUS_PRESENTATION, type EducationStatus } from '../../packages/education-presentation/notification.mjs'
import './StatusIcon.css'

/** Visual vocabulary only. The owning badge/summary supplies the full accessible label.
 * @see ../../docs/shared/design/statuses.md#matrix
 */
export type { EducationStatus }

const lucideIcons: Record<string, LucideIcon> = { BellDot, Circle, CircleAlert, CircleCheck, CircleDot, CircleHelp, CircleMinus,
  CirclePause, CircleX, Clock3, CloudUpload, LoaderCircle, TriangleAlert }
function iconByName(name: string): LucideIcon { return lucideIcons[name] }

const icons: Record<EducationStatus, LucideIcon> = {
  ready: iconByName(STATUS_PRESENTATION.ready.icon),
  started: iconByName(STATUS_PRESENTATION.started.icon),
  uploading: iconByName(STATUS_PRESENTATION.uploading.icon),
  waiting: iconByName(STATUS_PRESENTATION.waiting.icon),
  processing: iconByName(STATUS_PRESENTATION.processing.icon),
  paused: iconByName(STATUS_PRESENTATION.paused.icon),
  complete: iconByName(STATUS_PRESENTATION.complete.icon),
  partial: iconByName(STATUS_PRESENTATION.partial.icon),
  'needs-fix': iconByName(STATUS_PRESENTATION['needs-fix'].icon),
  incorrect: iconByName(STATUS_PRESENTATION.incorrect.icon),
  unknown: iconByName(STATUS_PRESENTATION.unknown.icon),
  failed: iconByName(STATUS_PRESENTATION.failed.icon),
  new: iconByName(STATUS_PRESENTATION.new.icon),
}


export default function StatusIcon({ status, size = 16, className = '' }: {
  status: EducationStatus; size?: number; className?: string
}) {
  const Icon = icons[status]
  return <Icon size={size} className={`edu-status-icon edu-status-icon-${status} ${className}`.trim()} data-status={status} aria-hidden="true" />
}
