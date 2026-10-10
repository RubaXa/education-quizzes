import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { DayMaterialLink, DaySourceCrop } from '@/lib/dayStore'
import { publicImage } from '@/lib/yandexPublic'
import './SourceFragment.css'

function CropView({ src, crop, number, onError }: { src: string; crop: DaySourceCrop; number: number; onError: () => void }) {
  const style = {
    aspectRatio: `${crop.width} / ${crop.height}`,
    '--crop-image-width': `${crop.sourceWidth / crop.width * 100}%`,
    '--crop-image-left': `${-crop.x / crop.width * 100}%`,
    '--crop-image-top': `${-crop.y / crop.height * 100}%`,
  } as CSSProperties
  return <div className="source-fragment-viewport" style={style}>
    <img src={src} alt={`Точный фрагмент листа учителя: задача № ${number}`} referrerPolicy="no-referrer" onError={onError} />
  </div>
}

/** Coordinate-based viewport onto the preserved original. No rewritten image is stored. */
export default function SourceFragment({ link, crop, number }: { link: DayMaterialLink; crop: DaySourceCrop; number: number }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [whole, setWhole] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const retryRef = useRef<() => void>(() => {})

  useEffect(() => {
    let active = true
    let attempts = 0
    let timer: number | undefined
    let waiting = false
    function retry() {
      if (!active || waiting) return
      setSrc('')
      if (attempts >= 3) { setFailed(true); return }
      waiting = true
      timer = window.setTimeout(() => { waiting = false; load() }, attempts * 500)
    }
    function load() {
      attempts += 1
      void publicImage(link.url, 'XXXL', attempts > 1).then((url) => {
        if (active) { setSrc(url); setFailed(false) }
      }).catch(retry)
    }
    retryRef.current = retry
    load()
    return () => { active = false; window.clearTimeout(timer); retryRef.current = () => {} }
  }, [link.url])

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
  const sourceAvailable = Boolean(src) && !failed
  return <div className="source-fragment">
    <button type="button" className="source-fragment-trigger" onClick={show} aria-label={`Открыть фрагмент оригинального листа с задачей № ${number}`}>
      {sourceAvailable ? <CropView src={src} crop={crop} number={number} onError={() => retryRef.current()} /> : <span className="source-fragment-placeholder">{failed ? 'Фрагмент временно недоступен' : 'Загружаем фрагмент…'}</span>}
      <small>Фрагмент № {number} · открыть крупно</small>
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
          {!sourceAvailable && <p>{failed ? 'Не удалось загрузить изображение. Откройте исходный лист на Диске.' : 'Загружаем изображение…'}</p>}
          {sourceAvailable && (whole ? <img className="source-fragment-whole" src={src} alt="Весь исходный лист учителя" referrerPolicy="no-referrer" onError={() => retryRef.current()} />
            : <div className="source-fragment-large"><CropView src={src} crop={crop} number={number} onError={() => retryRef.current()} /></div>)}
        </div>
        <a className="day-reader-external" href={link.url} target="_blank" rel="noopener noreferrer">Открыть оригинал на Яндекс.Диске <ExternalLink size={14} /></a>
      </div>
    </div>, document.body)}
  </div>
}
