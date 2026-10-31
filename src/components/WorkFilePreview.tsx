/** Document presentation shared by local and confirmed solution attachments.
 * @see ../../docs/shared/media-storage.md */
import { useEffect, useState } from 'react'
import { FileText, FileSpreadsheet, Presentation, File, ExternalLink } from 'lucide-react'
import { workFilePresentation } from '../../storage/work-file-types.mjs'
import EducationImage from './EducationImage'
import './WorkFilePreview.css'

type WorkFilePreviewProps = {
  file: { contentType?: string; originalName?: string; name?: string; type?: string; storage?: { path?: string } }; compact?: boolean; href?: string; source?: string; resolver?: (source: string) => Promise<string>
}

/** Images use the existing renderer; only unrendered documents receive a type icon. */
export default function WorkFilePreview(props: WorkFilePreviewProps) {
  const { kind, name } = workFilePresentation(props.file)
  if (kind === 'photo') return <span className={`work-file-preview work-file-preview-image${props.compact ? ' work-file-preview-compact' : ''}`} data-file-kind="photo">
    <EducationImage source={props.href ?? props.source ?? ''} resolver={props.href ? undefined : props.resolver} revokeResolvedUrl={!props.href && Boolean(props.resolver)} alt={name || 'Изображение работы'} compact={props.compact} retryControl={!props.compact} />
    {!props.compact && name && <strong>{name}</strong>}
  </span>
  return <DocumentPreview {...props} />
}

function DocumentPreview({ file, compact = false, href, source, resolver }: WorkFilePreviewProps) {
  const [resolved, setResolved] = useState<{ source: string; url: string }>()
  useEffect(() => {
    if (compact || href || !source || !resolver) return
    let active = true, objectUrl: string | undefined
    void resolver(source).then(url => {
      if (!active) { URL.revokeObjectURL(url); return }
      objectUrl = url
      setResolved({ source, url })
    }).catch(() => {}) // The transfer status explains when the original is on another device.
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [compact, href, source, resolver])
  const target = href ?? (resolved?.source === source ? resolved?.url : undefined)
  const { kind, label, extension, name } = workFilePresentation(file)
  const Icon = kind === 'spreadsheet' ? FileSpreadsheet : kind === 'presentation' ? Presentation : kind === 'document' || kind === 'text' || kind === 'pdf' ? FileText : File
  return <span className={`work-file-preview${compact ? ' work-file-preview-compact' : ''}`} data-file-kind={kind}>
    <Icon size={compact ? 20 : 32} aria-hidden="true" />
    <span className="work-file-format">{extension.toUpperCase() || label}</span>
    {!compact && <><strong>{name || label}</strong>{target && <a href={target} target="_blank" rel="noopener noreferrer" download={target.startsWith('blob:') ? name : undefined}>Открыть файл <ExternalLink size={13} aria-hidden="true" /></a>}</>}
  </span>
}
