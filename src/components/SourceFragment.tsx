import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { DayMaterialLink, DaySourceCrop, DayUpload } from '@/lib/dayStore'
import EducationImage from './EducationImage'
import { WorkArtifactImage } from './ArtifactAvatar'
import './SourceFragment.css'

/** Coordinate-based viewport onto the preserved original. No rewritten image is stored.
 * @see ../../docs/shared/design/README.md#images
 * @see ../../docs/modules/reviews/problem-card-design-decisions.md#flat-numbered-sheet */
export default function SourceFragment({ link, upload, crop, number, onOpen }: { link?: DayMaterialLink; upload?: DayUpload; crop: DaySourceCrop; number: number; onOpen?: () => void }) {
  const [open, setOpen] = useState(false)
  const [whole, setWhole] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    function keydown(event: KeyboardEvent) { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', keydown)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', keydown) }
  }, [open])

  const label = upload ? 'Фото условия' : 'Оригинал учителя'
  const picture = (full: boolean, large = false) => upload ? <WorkArtifactImage upload={upload} title={`условие задачи № ${number}`} index={0} crop={full ? undefined : crop} imageClassName={large ? full ? 'source-fragment-whole' : 'source-fragment-large' : ''} retryControl={large} /> : link ? <EducationImage source={link.url} mode="public" crop={full ? undefined : crop} alt={`Оригинал задачи № ${number}`} className={large ? full ? 'source-fragment-whole' : 'source-fragment-large' : ''} retryControl={large} /> : null
  function show() { setWhole(false); setZoomed(false); setOpen(true); onOpen?.() }
  return <div className="source-fragment">
    <button type="button" className="source-fragment-trigger" onClick={show} aria-label={`Открыть фрагмент оригинального листа с задачей № ${number}`}>
      <span className="source-fragment-caption"><strong>{label}</strong><small>Открыть крупно ↗</small></span>
      {picture(false)}
    </button>
    {open && createPortal(<div className="day-reader-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <div className="day-reader-dialog" role="dialog" aria-modal="true" aria-label={`Оригинал задачи № ${number}`}>
        <header><div><strong>Задача № {number} · {upload ? 'фото условия' : 'лист учителя'}</strong><span>{whole ? 'Весь исходный лист' : 'Точный фрагмент исходного листа'}</span></div>
          <div className="day-reader-header-actions">
            <button type="button" className="source-fragment-switch" onClick={() => { setWhole((value) => !value); setZoomed(false) }}>{whole ? 'К фрагменту' : 'Весь лист'}</button>
            <button type="button" className="day-reader-close" onClick={() => setZoomed((value) => !value)} aria-label={zoomed ? 'Уменьшить' : 'Увеличить'}>{zoomed ? <ZoomOut size={22} /> : <ZoomIn size={22} />}</button>
            <button type="button" ref={closeRef} className="day-reader-close" onClick={() => setOpen(false)} aria-label="Закрыть просмотрщик"><X size={23} /></button>
          </div></header>
        <div className={`day-reader-stage source-fragment-stage${zoomed ? ' zoomed' : ''}`}>
          {picture(whole, true)}
        </div>
        {link && <a className="day-reader-external" href={link.url} target="_blank" rel="noopener noreferrer">Открыть оригинал на Яндекс.Диске <ExternalLink size={14} /></a>}
      </div>
    </div>, document.body)}
  </div>
}
