import { Camera } from 'lucide-react'

/** One multi-photo action for written homework and numbered problems.
 * Its visibility is decided by the task's completion, never by the number
 * or review status of earlier photos. @see ../../docs/modules/school-diary/day-page.md#upload-queue */
export default function PhotoUploadControl({ label, onPhotos, className = 'day-upload' }: {
  label: string; onPhotos: (files: File[]) => void; className?: string
}) {
  return <label className={className}><Camera size={17} aria-hidden="true" /> {label}<input type="file" accept="image/*" multiple onChange={(event) => {
    const files = Array.from(event.currentTarget.files ?? [])
    if (files.length) onPhotos(files)
    event.currentTarget.value = ''
  }} /></label>
}
