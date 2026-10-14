import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { DayMaterialLink, DaySourceCrop } from '@/lib/dayStore'
import EducationImage from './EducationImage'
import './SourceFragment.css'

/** Coordinate-based viewport onto the preserved original. No rewritten image is stored.
 * @see ../../docs/product/design-system.md#images
 * @see ../../docs/product/problem-card-design-decisions.md#flat-numbered-sheet */
export default function SourceFragment({ link, crop, number, excerpt }: { link: DayMaterialLink; crop: DaySourceCrop; number: number; excerpt?: string }) {
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

  function show() { setWhole(false); setZoomed(false); setOpen(true) }
  return <div className="source-fragment">
    <button type="button" className="source-fragment-trigger" onClick={show} aria-label={`Открыть фрагмент оригинального листа с задачей № ${number}`}>
      {excerpt ? <><strong>Оригинал · открыть крупно ↗</strong><span>{excerpt.slice(0, 115)}{excerpt.length > 115 ? '…' : ''}</span></>
        : <><EducationImage source={link.url} mode="public" crop={crop} alt={`Точный фрагмент листа учителя: задача № ${number}`} retryControl={false} /><small>Фрагмент № {number} · открыть крупно</small></>}
    </button>
    {open && createPortal(<div className="day-reader-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
      <div className="day-reader-dialog" role="dialog" aria-modal="true" aria-label={`Оригинал задачи № ${number}`}>
        <header><div><strong>Задача № {number} · лист учителя</strong><span>{whole ? 'Весь исходный лист' : 'Точный фрагмент исходного листа'}</span></div>
          <div className="day-reader-header-actions">
            <button type="button" className="source-fragment-switch" onClick={() => { setWhole((value) => !value); setZoomed(false) }}>{whole ? 'К фрагменту' : 'Весь лист'}</button>
            <button type="button" className="day-reader-close" onClick={() => setZoomed((value) => !value)} aria-label={zoomed ? 'Уменьшить' : 'Увеличить'}>{zoomed ? <ZoomOut size={22} /> : <ZoomIn size={22} />}</button>
            <button type="button" ref={closeRef} className="day-reader-close" onClick={() => setOpen(false)} aria-label="Закрыть просмотрщик"><X size={23} /></button>
          </div></header>
        <div className={`day-reader-stage source-fragment-stage${zoomed ? ' zoomed' : ''}`}>
          {whole ? <EducationImage source={link.url} mode="public" alt="Весь исходный лист учителя" className="source-fragment-whole" loading="eager" />
            : <EducationImage source={link.url} mode="public" crop={crop} alt={`Точный фрагмент листа учителя: задача № ${number}`} className="source-fragment-large" loading="eager" />}
        </div>
        <a className="day-reader-external" href={link.url} target="_blank" rel="noopener noreferrer">Открыть оригинал на Яндекс.Диске <ExternalLink size={14} /></a>
      </div>
    </div>, document.body)}
  </div>
}
