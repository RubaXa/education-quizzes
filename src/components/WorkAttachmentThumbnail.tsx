/** Existing gallery thumbnail control, shared by local and confirmed files.
 * @see ../../docs/shared/design/components.md#work-artifacts */
import type { ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import './WorkAttachmentThumbnail.css'

export default function WorkAttachmentThumbnail({ label, selected, onToggle, children, choosing = false, disabled = false, compact = false, onDelete, deleteLabel, deleting = false }: {
  label: string; selected: boolean; onToggle: () => void; children: ReactNode; choosing?: boolean; disabled?: boolean; compact?: boolean;
  onDelete?: () => void; deleteLabel?: string; deleting?: boolean
}) {
  const thumbnail = <button className="day-upload-chip" type="button" title={label} aria-label={`${choosing ? 'Выбрать' : 'Открыть'} ${label}`} aria-expanded={choosing ? undefined : selected} aria-pressed={choosing ? selected : undefined} disabled={disabled} onClick={onToggle}>{children}{choosing && selected && <span className="day-upload-selected" aria-hidden="true"><Check size={12} /></span>}</button>
  return compact ? <span className="weekend-math-photo-item">{thumbnail}{!choosing && onDelete && <button type="button" className="weekend-math-photo-delete" aria-label={deleteLabel} disabled={deleting} onClick={onDelete}><X size={11} aria-hidden="true" /></button>}</span> : thumbnail
}
